-- Vendor-Fair Event Participation.
-- Reworks promotion_campaigns (20260925143000) from "admin picks existing
-- products/vouchers as offers" into "vendors register a stall to join the
-- event, admin approves". See
-- Docs/plans/2026-09-28-1732-vendor-fair-event-participation.md.
--
-- Non-destructive: promotion_campaign_offers and promotion_campaign_offer_is_eligible
-- stay in place (historical data, e.g. the seeded Heritage Walk campaign) but
-- are no longer written to or read by the reworked functions below — the
-- admin offers-picker UI is retired in Phase 2. get_admin_promotion_campaign_sources
-- (only ever called by that picker) is dropped outright as dead code.
--
-- Participation is free — no wallet/Stripe payment, unlike vendor_event_promotions.
-- Review states mirror that feature's proven shape:
-- pending -> approved | rejected | changes_requested, editable only from
-- changes_requested, all mutations through SECURITY DEFINER RPCs (ADR-002).

-- ── promotion_campaigns: add event-specific fields ───────────────────────

ALTER TABLE public.promotion_campaigns
  ADD COLUMN IF NOT EXISTS poster_url TEXT,
  ADD COLUMN IF NOT EXISTS operating_hours TEXT;

-- ── promotion_campaign_vendors: a vendor's registration for an event ─────

CREATE TABLE IF NOT EXISTS public.promotion_campaign_vendors (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id                 UUID NOT NULL REFERENCES public.promotion_campaigns(id) ON DELETE CASCADE,
  vendor_id                   UUID NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  submitted_by                UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  stall_number                TEXT NOT NULL,
  stall_description           TEXT NOT NULL,
  stall_poster_url            TEXT NOT NULL,
  status                      TEXT NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending', 'approved', 'rejected', 'changes_requested')),
  reviewer_id                 UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at                 TIMESTAMPTZ,
  rejection_reason            TEXT,
  changes_requested_at        TIMESTAMPTZ,
  changes_requested_reason    TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT promotion_campaign_vendors_unique UNIQUE (campaign_id, vendor_id),
  CONSTRAINT promotion_campaign_vendors_stall_number_length CHECK (char_length(btrim(stall_number)) BETWEEN 1 AND 40),
  CONSTRAINT promotion_campaign_vendors_stall_description_length CHECK (char_length(btrim(stall_description)) BETWEEN 10 AND 2000)
);

CREATE INDEX IF NOT EXISTS promotion_campaign_vendors_campaign_idx
  ON public.promotion_campaign_vendors (campaign_id, status);
CREATE INDEX IF NOT EXISTS promotion_campaign_vendors_vendor_idx
  ON public.promotion_campaign_vendors (vendor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.promotion_campaign_vendor_review_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id UUID NOT NULL REFERENCES public.promotion_campaign_vendors(id) ON DELETE CASCADE,
  from_status     TEXT NOT NULL,
  to_status       TEXT NOT NULL,
  action          TEXT NOT NULL CHECK (action IN ('submit', 'approve', 'reject', 'request_changes', 'resubmit')),
  actor_id        UUID REFERENCES public.users(id) ON DELETE SET NULL,
  actor_role      TEXT NOT NULL,
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS promotion_campaign_vendor_review_events_subject_idx
  ON public.promotion_campaign_vendor_review_events (registration_id, created_at, id);

-- ── promotion_campaign_vendor_products: what a stall sells ────────────────
-- Either a reference to the vendor's real catalog product (picked), or a
-- standalone name+price+photo entry that exists only for this event and is
-- never written into the vendor's real /vendor/products catalog.

CREATE TABLE IF NOT EXISTS public.promotion_campaign_vendor_products (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id UUID NOT NULL REFERENCES public.promotion_campaign_vendors(id) ON DELETE CASCADE,
  product_id      UUID REFERENCES public.products(id) ON DELETE CASCADE,
  name            TEXT,
  price           NUMERIC(10,2),
  image_url       TEXT,
  position        INTEGER NOT NULL CHECK (position BETWEEN 0 AND 49),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT promotion_campaign_vendor_products_source CHECK (
    (product_id IS NOT NULL AND name IS NULL AND price IS NULL)
    OR (product_id IS NULL AND name IS NOT NULL AND price IS NOT NULL AND price >= 0)
  ),
  CONSTRAINT promotion_campaign_vendor_products_name_length CHECK (name IS NULL OR char_length(btrim(name)) BETWEEN 2 AND 120),
  CONSTRAINT promotion_campaign_vendor_products_position_unique UNIQUE (registration_id, position)
);

CREATE INDEX IF NOT EXISTS promotion_campaign_vendor_products_registration_idx
  ON public.promotion_campaign_vendor_products (registration_id, position);

ALTER TABLE public.promotion_campaign_vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_campaign_vendor_review_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_campaign_vendor_products ENABLE ROW LEVEL SECURITY;

-- No public RLS branch on these tables — the public customer surface reads
-- exclusively through get_public_promotion_campaigns (SECURITY DEFINER, exposes
-- only approved registrations), matching how vouchers/products are exposed
-- through that same RPC rather than direct table grants.

DROP POLICY IF EXISTS promotion_campaign_vendors_read ON public.promotion_campaign_vendors;
CREATE POLICY promotion_campaign_vendors_read ON public.promotion_campaign_vendors
  FOR SELECT TO authenticated
  USING (
    public.has_staff_permission(auth.uid(), 'admin.promotion_campaign.manage')
    OR EXISTS (
      SELECT 1 FROM public.vendors v
       WHERE v.id = vendor_id AND v.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.outlet_managers om
      JOIN public.outlets o ON o.id = om.outlet_id
     WHERE om.user_id = auth.uid() AND o.vendor_id = promotion_campaign_vendors.vendor_id
    )
  );

DROP POLICY IF EXISTS promotion_campaign_vendor_products_read ON public.promotion_campaign_vendor_products;
CREATE POLICY promotion_campaign_vendor_products_read ON public.promotion_campaign_vendor_products
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.promotion_campaign_vendors reg
       WHERE reg.id = registration_id
         AND (
           public.has_staff_permission(auth.uid(), 'admin.promotion_campaign.manage')
           OR EXISTS (SELECT 1 FROM public.vendors v WHERE v.id = reg.vendor_id AND v.owner_id = auth.uid())
           OR EXISTS (
             SELECT 1 FROM public.outlet_managers om
             JOIN public.outlets o ON o.id = om.outlet_id
            WHERE om.user_id = auth.uid() AND o.vendor_id = reg.vendor_id
           )
         )
    )
  );

REVOKE ALL ON TABLE public.promotion_campaign_vendor_review_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.promotion_campaign_vendor_review_events TO service_role;

-- No direct INSERT/UPDATE/DELETE policy for anyone — every transition goes
-- through the SECURITY DEFINER RPCs below (ADR-002).

-- ── RPC: vendor submits a new registration ────────────────────────────────

CREATE OR REPLACE FUNCTION public.submit_campaign_vendor_registration(
  p_campaign_id UUID,
  p_vendor_id UUID,
  p_stall_number TEXT,
  p_stall_description TEXT,
  p_stall_poster_url TEXT,
  p_products JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_owner BOOLEAN;
  v_campaign public.promotion_campaigns%ROWTYPE;
  v_registration_id UUID;
  v_item JSONB;
  v_position INTEGER := 0;
  v_product_id UUID;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.vendors v WHERE v.id = p_vendor_id AND v.owner_id = auth.uid() AND v.status = 'approved'
  ) OR EXISTS (
    SELECT 1 FROM public.outlet_managers om
    JOIN public.outlets o ON o.id = om.outlet_id
   WHERE om.user_id = auth.uid() AND o.vendor_id = p_vendor_id
  ) INTO v_is_owner;
  IF NOT v_is_owner THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT * INTO v_campaign FROM public.promotion_campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
  IF v_campaign.status <> 'approved' OR v_campaign.ends_at <= now() THEN
    RAISE EXCEPTION 'campaign_not_open';
  END IF;

  IF char_length(btrim(COALESCE(p_stall_number, ''))) NOT BETWEEN 1 AND 40 THEN RAISE EXCEPTION 'invalid_stall_number'; END IF;
  IF char_length(btrim(COALESCE(p_stall_description, ''))) NOT BETWEEN 10 AND 2000 THEN RAISE EXCEPTION 'invalid_stall_description'; END IF;
  IF p_stall_poster_url IS NULL OR btrim(p_stall_poster_url) = '' THEN RAISE EXCEPTION 'poster_required'; END IF;
  IF jsonb_typeof(p_products) <> 'array' OR jsonb_array_length(p_products) < 1 OR jsonb_array_length(p_products) > 30 THEN
    RAISE EXCEPTION 'invalid_products';
  END IF;

  IF EXISTS (SELECT 1 FROM public.promotion_campaign_vendors WHERE campaign_id = p_campaign_id AND vendor_id = p_vendor_id) THEN
    RAISE EXCEPTION 'already_registered';
  END IF;

  INSERT INTO public.promotion_campaign_vendors
    (campaign_id, vendor_id, submitted_by, stall_number, stall_description, stall_poster_url)
  VALUES
    (p_campaign_id, p_vendor_id, auth.uid(), btrim(p_stall_number), btrim(p_stall_description), p_stall_poster_url)
  RETURNING id INTO v_registration_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_products) AS elems(value) LOOP
    IF v_item ? 'productId' THEN
      v_product_id := (v_item->>'productId')::UUID;
      IF NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = v_product_id AND p.vendor_id = p_vendor_id) THEN
        RAISE EXCEPTION 'product_not_owned';
      END IF;
      INSERT INTO public.promotion_campaign_vendor_products (registration_id, product_id, position)
      VALUES (v_registration_id, v_product_id, v_position);
    ELSIF v_item ? 'name' AND v_item ? 'price' THEN
      INSERT INTO public.promotion_campaign_vendor_products (registration_id, name, price, image_url, position)
      VALUES (v_registration_id, btrim(v_item->>'name'), (v_item->>'price')::NUMERIC, v_item->>'imageUrl', v_position);
    ELSE
      RAISE EXCEPTION 'invalid_product_entry';
    END IF;
    v_position := v_position + 1;
  END LOOP;

  INSERT INTO public.promotion_campaign_vendor_review_events
    (registration_id, from_status, to_status, action, actor_id, actor_role, note)
  VALUES
    (v_registration_id, 'none', 'pending', 'submit', auth.uid(), 'vendor', NULL);

  RETURN v_registration_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_campaign_vendor_registration(UUID, UUID, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_campaign_vendor_registration(UUID, UUID, TEXT, TEXT, TEXT, JSONB) TO authenticated;

-- ── RPC: vendor resubmits after changes_requested ─────────────────────────

CREATE OR REPLACE FUNCTION public.resubmit_campaign_vendor_registration(
  p_registration_id UUID,
  p_stall_number TEXT,
  p_stall_description TEXT,
  p_stall_poster_url TEXT,
  p_products JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_vendor_id UUID;
  v_from_status TEXT;
  v_is_owner BOOLEAN;
  v_item JSONB;
  v_position INTEGER := 0;
  v_product_id UUID;
BEGIN
  SELECT vendor_id, status INTO v_vendor_id, v_from_status
    FROM public.promotion_campaign_vendors
   WHERE id = p_registration_id
     FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_from_status <> 'changes_requested' THEN RAISE EXCEPTION 'not_editable'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.vendors v WHERE v.id = v_vendor_id AND v.owner_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM public.outlet_managers om
    JOIN public.outlets o ON o.id = om.outlet_id
   WHERE om.user_id = auth.uid() AND o.vendor_id = v_vendor_id
  ) INTO v_is_owner;
  IF NOT v_is_owner THEN RAISE EXCEPTION 'forbidden'; END IF;

  IF char_length(btrim(COALESCE(p_stall_number, ''))) NOT BETWEEN 1 AND 40 THEN RAISE EXCEPTION 'invalid_stall_number'; END IF;
  IF char_length(btrim(COALESCE(p_stall_description, ''))) NOT BETWEEN 10 AND 2000 THEN RAISE EXCEPTION 'invalid_stall_description'; END IF;
  IF p_stall_poster_url IS NULL OR btrim(p_stall_poster_url) = '' THEN RAISE EXCEPTION 'poster_required'; END IF;
  IF jsonb_typeof(p_products) <> 'array' OR jsonb_array_length(p_products) < 1 OR jsonb_array_length(p_products) > 30 THEN
    RAISE EXCEPTION 'invalid_products';
  END IF;

  UPDATE public.promotion_campaign_vendors
     SET stall_number = btrim(p_stall_number),
         stall_description = btrim(p_stall_description),
         stall_poster_url = p_stall_poster_url,
         status = 'pending',
         reviewer_id = NULL,
         reviewed_at = NULL,
         rejection_reason = NULL,
         changes_requested_at = NULL,
         changes_requested_reason = NULL,
         updated_at = now()
   WHERE id = p_registration_id;

  DELETE FROM public.promotion_campaign_vendor_products WHERE registration_id = p_registration_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_products) AS elems(value) LOOP
    IF v_item ? 'productId' THEN
      v_product_id := (v_item->>'productId')::UUID;
      IF NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = v_product_id AND p.vendor_id = v_vendor_id) THEN
        RAISE EXCEPTION 'product_not_owned';
      END IF;
      INSERT INTO public.promotion_campaign_vendor_products (registration_id, product_id, position)
      VALUES (p_registration_id, v_product_id, v_position);
    ELSIF v_item ? 'name' AND v_item ? 'price' THEN
      INSERT INTO public.promotion_campaign_vendor_products (registration_id, name, price, image_url, position)
      VALUES (p_registration_id, btrim(v_item->>'name'), (v_item->>'price')::NUMERIC, v_item->>'imageUrl', v_position);
    ELSE
      RAISE EXCEPTION 'invalid_product_entry';
    END IF;
    v_position := v_position + 1;
  END LOOP;

  INSERT INTO public.promotion_campaign_vendor_review_events
    (registration_id, from_status, to_status, action, actor_id, actor_role, note)
  VALUES
    (p_registration_id, v_from_status, 'pending', 'resubmit', auth.uid(), 'vendor', NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.resubmit_campaign_vendor_registration(UUID, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resubmit_campaign_vendor_registration(UUID, TEXT, TEXT, TEXT, JSONB) TO authenticated;

-- ── RPC: admin review (approve / reject / request_changes) ───────────────

CREATE OR REPLACE FUNCTION public.review_campaign_vendor_registration(
  p_registration_id UUID,
  p_action TEXT,
  p_note TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_from_status TEXT;
  v_to_status TEXT;
BEGIN
  IF NOT public.has_staff_permission(auth.uid(), 'admin.promotion_campaign.manage') THEN
    RAISE EXCEPTION 'admin_required';
  END IF;
  IF p_action NOT IN ('approve', 'reject', 'request_changes') THEN
    RAISE EXCEPTION 'invalid_action';
  END IF;
  IF p_action IN ('reject', 'request_changes') AND char_length(BTRIM(COALESCE(p_note, ''))) < 10 THEN
    RAISE EXCEPTION 'note_required';
  END IF;

  SELECT status INTO v_from_status
    FROM public.promotion_campaign_vendors
   WHERE id = p_registration_id
     FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_from_status != 'pending' THEN RAISE EXCEPTION 'not_pending'; END IF;

  v_to_status := CASE p_action
    WHEN 'approve' THEN 'approved'
    WHEN 'reject' THEN 'rejected'
    ELSE 'changes_requested'
  END;

  UPDATE public.promotion_campaign_vendors
     SET status = v_to_status,
         reviewer_id = auth.uid(),
         reviewed_at = now(),
         rejection_reason = CASE WHEN p_action = 'reject' THEN BTRIM(p_note) ELSE NULL END,
         changes_requested_at = CASE WHEN p_action = 'request_changes' THEN now() ELSE NULL END,
         changes_requested_reason = CASE WHEN p_action = 'request_changes' THEN BTRIM(p_note) ELSE NULL END,
         updated_at = now()
   WHERE id = p_registration_id;

  INSERT INTO public.promotion_campaign_vendor_review_events
    (registration_id, from_status, to_status, action, actor_id, actor_role, note)
  VALUES
    (p_registration_id, v_from_status, v_to_status, p_action, auth.uid(), 'admin', p_note);
END;
$$;

REVOKE ALL ON FUNCTION public.review_campaign_vendor_registration(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_campaign_vendor_registration(UUID, TEXT, TEXT) TO authenticated;

-- ── vendor_announcements: general bulletin board (super admin -> vendors) ─
-- Writes go through a staff-gated API route using the service client (same
-- precedent as platform_settings / event-promotion cost-per-day) — no RLS
-- INSERT policy needed since only staff ever create these, and the route
-- already gates on the permission below.

CREATE TABLE IF NOT EXISTS public.vendor_announcements (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  sender_code  TEXT NOT NULL DEFAULT 'ADMIN',
  campaign_id  UUID REFERENCES public.promotion_campaigns(id) ON DELETE SET NULL,
  created_by   UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT vendor_announcements_title_length CHECK (char_length(btrim(title)) BETWEEN 3 AND 160),
  CONSTRAINT vendor_announcements_body_length CHECK (char_length(btrim(body)) BETWEEN 10 AND 5000),
  CONSTRAINT vendor_announcements_sender_code_length CHECK (char_length(btrim(sender_code)) BETWEEN 1 AND 20)
);

CREATE INDEX IF NOT EXISTS vendor_announcements_created_idx ON public.vendor_announcements (created_at DESC);

CREATE TABLE IF NOT EXISTS public.vendor_announcement_reads (
  announcement_id UUID NOT NULL REFERENCES public.vendor_announcements(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  read_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, user_id)
);

ALTER TABLE public.vendor_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_announcement_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vendor_announcements_read ON public.vendor_announcements;
CREATE POLICY vendor_announcements_read ON public.vendor_announcements
  FOR SELECT TO authenticated
  USING (
    public.has_staff_permission(auth.uid(), 'admin.vendor_announcement.manage')
    OR EXISTS (SELECT 1 FROM public.vendors v WHERE v.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.outlet_managers om WHERE om.user_id = auth.uid())
  );

DROP POLICY IF EXISTS vendor_announcement_reads_own ON public.vendor_announcement_reads;
CREATE POLICY vendor_announcement_reads_own ON public.vendor_announcement_reads
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON TABLE public.vendor_announcements FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.vendor_announcements TO authenticated, service_role;
REVOKE ALL ON TABLE public.vendor_announcement_reads FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.vendor_announcement_reads TO authenticated;

-- ── RPC: vendor marks an announcement read (idempotent) ───────────────────

CREATE OR REPLACE FUNCTION public.mark_vendor_announcement_read(p_announcement_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.vendor_announcements WHERE id = p_announcement_id) THEN
    RAISE EXCEPTION 'not_found';
  END IF;
  INSERT INTO public.vendor_announcement_reads (announcement_id, user_id)
  VALUES (p_announcement_id, auth.uid())
  ON CONFLICT (announcement_id, user_id) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_vendor_announcement_read(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_vendor_announcement_read(UUID) TO authenticated;

-- ── Rework save_promotion_campaign_draft: drop offers, add poster/hours ──
-- Signature changes (drops p_offers, adds p_poster_url/p_operating_hours) —
-- CREATE OR REPLACE only replaces a function with the exact same argument
-- types, so the old 9-arg version must be dropped explicitly first (same
-- overload-drift lesson learned in 20260928030000).

DROP FUNCTION IF EXISTS public.save_promotion_campaign_draft(UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, JSONB);

CREATE OR REPLACE FUNCTION public.save_promotion_campaign_draft(
  p_campaign_id UUID,
  p_expected_updated_at TIMESTAMPTZ,
  p_title TEXT,
  p_slug TEXT,
  p_summary TEXT,
  p_description TEXT,
  p_starts_at TIMESTAMPTZ,
  p_ends_at TIMESTAMPTZ,
  p_poster_url TEXT,
  p_operating_hours TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_campaign public.promotion_campaigns%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR NOT public.has_staff_permission(v_actor, 'admin.promotion_campaign.manage') THEN
    RAISE EXCEPTION 'promotion_campaign_permission_required';
  END IF;
  IF p_title IS NULL OR char_length(btrim(p_title)) NOT BETWEEN 3 AND 120
     OR p_slug IS NULL OR p_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
     OR p_summary IS NULL OR char_length(btrim(p_summary)) NOT BETWEEN 10 AND 240
     OR p_description IS NULL OR char_length(btrim(p_description)) NOT BETWEEN 10 AND 5000
     OR p_starts_at IS NULL OR p_ends_at IS NULL OR p_ends_at <= p_starts_at
     OR p_operating_hours IS NULL OR char_length(btrim(p_operating_hours)) NOT BETWEEN 3 AND 200 THEN
    RAISE EXCEPTION 'promotion_campaign_invalid_draft';
  END IF;

  IF p_campaign_id IS NULL THEN
    IF p_expected_updated_at IS NOT NULL THEN
      RAISE EXCEPTION 'promotion_campaign_stale';
    END IF;
    INSERT INTO public.promotion_campaigns (
      slug, title, summary, description, starts_at, ends_at, poster_url, operating_hours, created_by, updated_by
    ) VALUES (
      btrim(p_slug), btrim(p_title), btrim(p_summary), btrim(p_description),
      p_starts_at, p_ends_at, p_poster_url, btrim(p_operating_hours), v_actor, v_actor
    ) RETURNING * INTO v_campaign;
  ELSE
    SELECT * INTO v_campaign
      FROM public.promotion_campaigns
     WHERE id = p_campaign_id
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'promotion_campaign_not_found'; END IF;
    IF v_campaign.status NOT IN ('draft', 'rejected')
       OR p_expected_updated_at IS NULL
       OR v_campaign.updated_at IS DISTINCT FROM p_expected_updated_at THEN
      RAISE EXCEPTION 'promotion_campaign_stale';
    END IF;
    UPDATE public.promotion_campaigns
       SET slug = btrim(p_slug), title = btrim(p_title), summary = btrim(p_summary),
           description = btrim(p_description), starts_at = p_starts_at, ends_at = p_ends_at,
           poster_url = p_poster_url, operating_hours = btrim(p_operating_hours),
           status = CASE WHEN status = 'rejected' THEN 'draft' ELSE status END,
           rejection_note = CASE WHEN status = 'rejected' THEN NULL ELSE rejection_note END,
           updated_by = v_actor, updated_at = now()
     WHERE id = p_campaign_id
     RETURNING * INTO v_campaign;
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, after_data)
  VALUES (
    v_actor,
    CASE WHEN p_campaign_id IS NULL THEN 'promotion_campaign.created' ELSE 'promotion_campaign.draft_updated' END,
    'promotion_campaign', v_campaign.id,
    jsonb_build_object('status', v_campaign.status, 'slug', v_campaign.slug)
  );

  RETURN to_jsonb(v_campaign);
END;
$$;

REVOKE ALL ON FUNCTION public.save_promotion_campaign_draft(UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_promotion_campaign_draft(UUID, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT) TO authenticated;

-- ── Rework transition_promotion_campaign: drop the offers-eligibility gate ─
-- Same (UUID, TEXT, TIMESTAMPTZ, TEXT) signature — true CREATE OR REPLACE,
-- no drop needed. The old "must have >=1 eligible offer" gate for
-- submit/approve/resume is replaced with "must have a poster" — the
-- equivalent minimum-content-readiness gate under the new event model.

CREATE OR REPLACE FUNCTION public.transition_promotion_campaign(
  p_campaign_id UUID,
  p_action TEXT,
  p_expected_updated_at TIMESTAMPTZ,
  p_note TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_campaign public.promotion_campaigns%ROWTYPE;
  v_before JSONB;
  v_next_status TEXT;
BEGIN
  IF v_actor IS NULL OR NOT public.has_staff_permission(v_actor, 'admin.promotion_campaign.manage') THEN
    RAISE EXCEPTION 'promotion_campaign_permission_required';
  END IF;
  IF p_action NOT IN ('submit', 'approve', 'reject', 'pause', 'resume', 'archive')
     OR p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'promotion_campaign_invalid_transition';
  END IF;
  IF p_action = 'reject' AND char_length(btrim(coalesce(p_note, ''))) NOT BETWEEN 10 AND 500 THEN
    RAISE EXCEPTION 'promotion_campaign_rejection_note_required';
  END IF;

  SELECT * INTO v_campaign
    FROM public.promotion_campaigns
   WHERE id = p_campaign_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'promotion_campaign_not_found'; END IF;
  IF v_campaign.updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'promotion_campaign_stale';
  END IF;
  v_before := to_jsonb(v_campaign);

  IF p_action = 'submit' AND v_campaign.status IN ('draft', 'rejected') THEN
    v_next_status := 'pending_approval';
  ELSIF p_action = 'approve' AND v_campaign.status = 'pending_approval' THEN
    IF v_campaign.created_by IS NOT DISTINCT FROM v_actor THEN
      RAISE EXCEPTION 'promotion_campaign_creator_cannot_approve';
    END IF;
    v_next_status := 'approved';
  ELSIF p_action = 'reject' AND v_campaign.status = 'pending_approval' THEN
    v_next_status := 'rejected';
  ELSIF p_action = 'pause' AND v_campaign.status = 'approved' THEN
    v_next_status := 'paused';
  ELSIF p_action = 'resume' AND v_campaign.status = 'paused' AND v_campaign.ends_at > now() THEN
    v_next_status := 'approved';
  ELSIF p_action = 'archive' AND v_campaign.status <> 'archived' THEN
    v_next_status := 'archived';
  ELSE
    RAISE EXCEPTION 'promotion_campaign_invalid_transition';
  END IF;

  IF p_action IN ('submit', 'approve', 'resume') AND (v_campaign.poster_url IS NULL OR btrim(v_campaign.poster_url) = '') THEN
    RAISE EXCEPTION 'promotion_campaign_poster_required';
  END IF;

  UPDATE public.promotion_campaigns
     SET status = v_next_status,
         updated_by = v_actor,
         updated_at = now(),
         approved_by = CASE WHEN p_action = 'approve' THEN v_actor WHEN p_action = 'submit' THEN NULL ELSE approved_by END,
         approved_at = CASE WHEN p_action = 'approve' THEN now() WHEN p_action = 'submit' THEN NULL ELSE approved_at END,
         rejection_note = CASE WHEN p_action = 'reject' THEN btrim(p_note) WHEN p_action IN ('submit', 'approve') THEN NULL ELSE rejection_note END
   WHERE id = v_campaign.id
   RETURNING * INTO v_campaign;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data, note)
  VALUES (
    v_actor,
    'promotion_campaign.' || p_action,
    'promotion_campaign',
    v_campaign.id,
    v_before,
    jsonb_build_object('status', v_campaign.status, 'slug', v_campaign.slug, 'approvedBy', v_campaign.approved_by),
    nullif(btrim(p_note), '')
  );

  RETURN to_jsonb(v_campaign);
END;
$$;

-- ── Rework get_public_promotion_campaigns: participating vendors, not offers ─
-- Same (TEXT) signature — true CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.get_public_promotion_campaigns(p_slug TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_campaign RECORD;
  v_reg RECORD;
  v_product RECORD;
  v_products JSONB;
  v_vendors JSONB;
  v_vendor_entry JSONB;
  v_result JSONB := '[]'::JSONB;
  v_visibility TEXT;
BEGIN
  FOR v_campaign IN
    SELECT campaign.*
      FROM public.promotion_campaigns AS campaign
     WHERE campaign.status = 'approved'
       AND campaign.ends_at > now()
       AND (p_slug IS NULL OR campaign.slug = p_slug)
     ORDER BY campaign.starts_at ASC, campaign.created_at DESC
  LOOP
    v_vendors := '[]'::JSONB;

    FOR v_reg IN
      SELECT reg.*, vendor.name AS vendor_name, vendor.logo_url AS vendor_logo_url
        FROM public.promotion_campaign_vendors AS reg
        JOIN public.vendors AS vendor ON vendor.id = reg.vendor_id
       WHERE reg.campaign_id = v_campaign.id
         AND reg.status = 'approved'
         AND vendor.status = 'approved'
       ORDER BY vendor.name
    LOOP
      v_products := '[]'::JSONB;

      FOR v_product IN
        SELECT
          vp.id,
          vp.position,
          COALESCE(product.name, vp.name) AS name,
          COALESCE(outlet_offer.price, vp.price) AS price,
          COALESCE(product.cover_url, product_media.url, vp.image_url) AS image_url
          FROM public.promotion_campaign_vendor_products AS vp
          LEFT JOIN public.products AS product ON product.id = vp.product_id
          LEFT JOIN public.outlet_offers AS outlet_offer
            ON outlet_offer.product_id = product.id AND outlet_offer.status = 'active'
          LEFT JOIN LATERAL (
            SELECT media.url
              FROM public.media_assets AS media
             WHERE media.product_id = product.id AND media.media_type = 'image'
             ORDER BY media.sort_order NULLS LAST, media.created_at
             LIMIT 1
          ) AS product_media ON product.id IS NOT NULL
         WHERE vp.registration_id = v_reg.id
         ORDER BY vp.position
      LOOP
        v_products := v_products || jsonb_build_array(jsonb_build_object(
          'id', v_product.id,
          'name', v_product.name,
          'price', v_product.price,
          'imageUrl', v_product.image_url
        ));
      END LOOP;

      v_vendor_entry := jsonb_build_object(
        'registrationId', v_reg.id,
        'vendorId', v_reg.vendor_id,
        'vendorName', v_reg.vendor_name,
        'vendorLogoUrl', v_reg.vendor_logo_url,
        'stallNumber', v_reg.stall_number,
        'stallDescription', v_reg.stall_description,
        'stallPosterUrl', v_reg.stall_poster_url,
        'products', v_products
      );
      v_vendors := v_vendors || jsonb_build_array(v_vendor_entry);
    END LOOP;

    v_visibility := CASE WHEN v_campaign.starts_at <= now() THEN 'live' ELSE 'upcoming' END;
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'id', v_campaign.id,
      'slug', v_campaign.slug,
      'title', v_campaign.title,
      'summary', v_campaign.summary,
      'description', v_campaign.description,
      'posterUrl', v_campaign.poster_url,
      'operatingHours', v_campaign.operating_hours,
      'startsAt', v_campaign.starts_at,
      'endsAt', v_campaign.ends_at,
      'visibility', v_visibility,
      'vendors', v_vendors
    ));
  END LOOP;

  RETURN v_result;
END;
$$;

-- ── Drop the offers-picker admin RPC (dead code — its only caller, the
-- offers-picker UI, is retired in Phase 2). promotion_campaign_offers and
-- promotion_campaign_offer_is_eligible stay (historical data), but this
-- lookup function served that UI exclusively.

DROP FUNCTION IF EXISTS public.get_admin_promotion_campaign_sources();

-- ── Staff permissions/modules ──────────────────────────────────────────
-- Registration review reuses admin.promotion_campaign.manage (same
-- governance surface as the campaign itself — the "Promotion Campaign
-- Manager" role template from 20260925143000 already grants it).
-- Announcements get their own permission (a general capability, not tied
-- to campaigns) — no bespoke role template for it; super_admin has it
-- automatically, others can be granted it via the existing staff-role
-- management UI when needed.

INSERT INTO public.staff_permissions (key, module, action, description, is_system)
VALUES ('admin.vendor_announcement.manage', 'admin', 'vendor_announcement.manage', 'Post announcements to vendors', TRUE)
ON CONFLICT (key) DO UPDATE SET
  module = EXCLUDED.module,
  action = EXCLUDED.action,
  description = EXCLUDED.description,
  is_system = TRUE;

INSERT INTO public.staff_modules (
  key, label, label_key, description, section_key, section_label,
  section_label_key, section_sort_order, href, icon_key, sort_order, is_system
)
VALUES (
  'campaign_registrations', 'Event Registrations', 'navigation.Event Registrations',
  'Review vendor registrations for promotion campaign events',
  'governance', 'Governance', 'navigationSections.governance', 20,
  '/admin/event-registrations', 'clipboard-check', 36, TRUE
)
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label,
  label_key = EXCLUDED.label_key,
  description = EXCLUDED.description,
  section_key = EXCLUDED.section_key,
  section_label = EXCLUDED.section_label,
  section_label_key = EXCLUDED.section_label_key,
  section_sort_order = EXCLUDED.section_sort_order,
  href = EXCLUDED.href,
  icon_key = EXCLUDED.icon_key,
  sort_order = EXCLUDED.sort_order,
  is_system = TRUE,
  updated_at = now();

INSERT INTO public.staff_modules (
  key, label, label_key, description, section_key, section_label,
  section_label_key, section_sort_order, href, icon_key, sort_order, is_system
)
VALUES (
  'vendor_announcements', 'Announcements', 'navigation.Announcements',
  'Post announcements to vendors',
  'governance', 'Governance', 'navigationSections.governance', 20,
  '/admin/announcements', 'megaphone', 37, TRUE
)
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label,
  label_key = EXCLUDED.label_key,
  description = EXCLUDED.description,
  section_key = EXCLUDED.section_key,
  section_label = EXCLUDED.section_label,
  section_label_key = EXCLUDED.section_label_key,
  section_sort_order = EXCLUDED.section_sort_order,
  href = EXCLUDED.href,
  icon_key = EXCLUDED.icon_key,
  sort_order = EXCLUDED.sort_order,
  is_system = TRUE,
  updated_at = now();

INSERT INTO public.staff_module_permissions (module_id, permission_id)
SELECT module_row.id, permission.id
  FROM public.staff_modules AS module_row
  JOIN public.staff_permissions AS permission ON permission.key = 'admin.promotion_campaign.manage'
 WHERE module_row.key = 'campaign_registrations'
ON CONFLICT (module_id, permission_id) DO NOTHING;

INSERT INTO public.staff_module_permissions (module_id, permission_id)
SELECT module_row.id, permission.id
  FROM public.staff_modules AS module_row
  JOIN public.staff_permissions AS permission ON permission.key = 'admin.vendor_announcement.manage'
 WHERE module_row.key = 'vendor_announcements'
ON CONFLICT (module_id, permission_id) DO NOTHING;

-- "Promotion Campaign Manager" role template (20260925143000) also sees the
-- registrations module, since it shares the same permission.
INSERT INTO public.staff_role_modules (role_id, module_id)
SELECT staff_role.id, module_row.id
  FROM public.staff_roles AS staff_role
  JOIN public.staff_modules AS module_row ON module_row.key = 'campaign_registrations'
 WHERE staff_role.name = 'Promotion Campaign Manager'
   AND staff_role.is_system IS TRUE
ON CONFLICT (role_id, module_id) DO NOTHING;
