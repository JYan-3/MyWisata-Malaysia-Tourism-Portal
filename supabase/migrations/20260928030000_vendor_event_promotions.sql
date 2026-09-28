-- Vendor Side-Event Promotion.
--
-- Distinct from promotion_campaigns (20260925143000): that table is for
-- platform events the ADMIN creates/hosts. This is for external events a
-- VENDOR is participating in but did not create — the vendor submits, an
-- admin (super_admin or approver, via the existing public.is_admin()) reviews,
-- and once approved the vendor PAYS (cost_per_day x duration) before it goes
-- public. See the "paid promotion" addendum in
-- Docs/plans/2026-09-28-0237-vendor-side-event-promotion.md.
--
-- Review states mirror vendor_recommendations' proven shape (see
-- 20260824221600_domain_role_matrix.sql / 20260824222000_recommendation_review_events.sql):
-- pending -> approved -> paid | rejected | changes_requested.
--   - changes_requested and approved (unpaid) are both editable — resubmitting
--     moves either back to pending for a fresh review.
--   - paid is terminal/locked: no edit path, matches "confirmed" in the spec.
--   - rejected is terminal, no edit path.
-- `approved` is the AWAITING-PAYMENT state, not yet publicly visible — only
-- `paid` is public. This is why the public read policy and index key off
-- status = 'paid', not 'approved'.
--
-- No direct vendor UPDATE policy, matching vendor_recommendations exactly
-- (that table has only SELECT + INSERT policies for the submitter — every
-- mutation goes through a SECURITY DEFINER RPC). Same here: all status
-- transitions, including the vendor's own resubmit and payment, go through
-- the RPCs below.

-- Idempotent/resumable: an earlier application of this migration's
-- pre-payment version was applied directly (outside `supabase db push`,
-- which is why it's untracked in supabase_migrations.schema_migrations) and
-- already created this table with the old event_time-based shape. Every
-- statement below must tolerate that partial starting state as well as a
-- genuinely clean database, so `db push` converges to the same end schema
-- either way.

CREATE TABLE IF NOT EXISTS public.vendor_event_promotions (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id                   UUID NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  submitted_by                UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  title                       TEXT NOT NULL,
  details                     TEXT NOT NULL,
  poster_url                  TEXT NOT NULL,
  status                      TEXT NOT NULL DEFAULT 'pending',
  reviewer_id                 UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reviewed_at                 TIMESTAMPTZ,
  rejection_reason            TEXT,
  changes_requested_at        TIMESTAMPTZ,
  changes_requested_reason    TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.vendor_event_promotions
  ADD COLUMN IF NOT EXISTS starts_on DATE,
  ADD COLUMN IF NOT EXISTS ends_on DATE,
  ADD COLUMN IF NOT EXISTS amount_sen BIGINT,
  ADD COLUMN IF NOT EXISTS payment_method TEXT,
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id TEXT,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

-- Backfill starts_on/ends_on from the deprecated single-timestamp
-- event_time column (only present under the old shape), then drop it.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'vendor_event_promotions' AND column_name = 'event_time'
  ) THEN
    UPDATE public.vendor_event_promotions
       SET starts_on = COALESCE(starts_on, event_time::date),
           ends_on = COALESCE(ends_on, event_time::date)
     WHERE starts_on IS NULL OR ends_on IS NULL;
    ALTER TABLE public.vendor_event_promotions DROP COLUMN event_time;
  END IF;
END $$;

ALTER TABLE public.vendor_event_promotions ALTER COLUMN starts_on SET NOT NULL;
ALTER TABLE public.vendor_event_promotions ALTER COLUMN ends_on SET NOT NULL;

-- Re-declare every CHECK/UNIQUE constraint idempotently. The `status` check
-- existed under the old shape too (as an unnamed, auto-named constraint) —
-- find and drop whatever it's actually called rather than assume the
-- default-naming convention, since this runs against a real database.
DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  SELECT con.conname INTO v_constraint_name
    FROM pg_constraint con
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
   WHERE con.conrelid = 'public.vendor_event_promotions'::regclass
     AND con.contype = 'c'
     AND att.attname = 'status';
  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.vendor_event_promotions DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $$;
ALTER TABLE public.vendor_event_promotions ADD CONSTRAINT vendor_event_promotions_status_check
  CHECK (status IN ('pending', 'approved', 'paid', 'rejected', 'changes_requested'));

ALTER TABLE public.vendor_event_promotions DROP CONSTRAINT IF EXISTS vendor_event_promotions_amount_sen_check;
ALTER TABLE public.vendor_event_promotions ADD CONSTRAINT vendor_event_promotions_amount_sen_check
  CHECK (amount_sen IS NULL OR amount_sen >= 0);

ALTER TABLE public.vendor_event_promotions DROP CONSTRAINT IF EXISTS vendor_event_promotions_payment_method_check;
ALTER TABLE public.vendor_event_promotions ADD CONSTRAINT vendor_event_promotions_payment_method_check
  CHECK (payment_method IS NULL OR payment_method IN ('wallet', 'stripe'));

ALTER TABLE public.vendor_event_promotions DROP CONSTRAINT IF EXISTS vendor_event_promotions_stripe_checkout_session_id_key;
ALTER TABLE public.vendor_event_promotions ADD CONSTRAINT vendor_event_promotions_stripe_checkout_session_id_key
  UNIQUE (stripe_checkout_session_id);

ALTER TABLE public.vendor_event_promotions DROP CONSTRAINT IF EXISTS vendor_event_promotions_title_length;
ALTER TABLE public.vendor_event_promotions ADD CONSTRAINT vendor_event_promotions_title_length
  CHECK (char_length(btrim(title)) BETWEEN 3 AND 120);

ALTER TABLE public.vendor_event_promotions DROP CONSTRAINT IF EXISTS vendor_event_promotions_details_length;
ALTER TABLE public.vendor_event_promotions ADD CONSTRAINT vendor_event_promotions_details_length
  CHECK (char_length(btrim(details)) BETWEEN 10 AND 2000);

ALTER TABLE public.vendor_event_promotions DROP CONSTRAINT IF EXISTS vendor_event_promotions_date_range;
ALTER TABLE public.vendor_event_promotions ADD CONSTRAINT vendor_event_promotions_date_range
  CHECK (ends_on >= starts_on);

CREATE INDEX IF NOT EXISTS vendor_event_promotions_vendor_idx ON public.vendor_event_promotions (vendor_id, created_at DESC);
DROP INDEX IF EXISTS public.vendor_event_promotions_public_idx;
CREATE INDEX vendor_event_promotions_public_idx ON public.vendor_event_promotions (status, ends_on)
  WHERE status = 'paid';

CREATE TABLE IF NOT EXISTS public.vendor_event_promotion_review_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id  UUID NOT NULL REFERENCES public.vendor_event_promotions(id) ON DELETE CASCADE,
  from_status   TEXT NOT NULL,
  to_status     TEXT NOT NULL,
  action        TEXT NOT NULL,
  actor_id      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  actor_role    TEXT NOT NULL,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  SELECT con.conname INTO v_constraint_name
    FROM pg_constraint con
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
   WHERE con.conrelid = 'public.vendor_event_promotion_review_events'::regclass
     AND con.contype = 'c'
     AND att.attname = 'action';
  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.vendor_event_promotion_review_events DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $$;
ALTER TABLE public.vendor_event_promotion_review_events ADD CONSTRAINT vendor_event_promotion_review_events_action_check
  CHECK (action IN ('approve', 'reject', 'request_changes', 'resubmit', 'pay'));

CREATE INDEX IF NOT EXISTS vendor_event_promotion_review_events_subject_idx
  ON public.vendor_event_promotion_review_events (promotion_id, created_at, id);

ALTER TABLE public.vendor_event_promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_event_promotion_review_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.vendor_event_promotion_review_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.vendor_event_promotion_review_events TO service_role;

-- ── vendor_event_promotions RLS ──────────────────────────────────────────

DROP POLICY IF EXISTS vendor_event_promotions_read ON public.vendor_event_promotions;
CREATE POLICY vendor_event_promotions_read ON public.vendor_event_promotions
  FOR SELECT USING (
    status = 'paid'
    OR public.is_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.vendors v
      WHERE v.id = vendor_id AND v.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.outlet_managers om
      JOIN public.outlets o ON o.id = om.outlet_id
      WHERE om.user_id = auth.uid() AND o.vendor_id = vendor_event_promotions.vendor_id
    )
  );

DROP POLICY IF EXISTS vendor_event_promotions_insert_own ON public.vendor_event_promotions;
CREATE POLICY vendor_event_promotions_insert_own ON public.vendor_event_promotions
  FOR INSERT TO authenticated
  WITH CHECK (
    submitted_by = auth.uid()
    AND status = 'pending'
    AND (
      EXISTS (
        SELECT 1 FROM public.vendors v
        WHERE v.id = vendor_id AND v.owner_id = auth.uid() AND v.status = 'approved'
      )
      OR EXISTS (
        SELECT 1 FROM public.outlet_managers om
        JOIN public.outlets o ON o.id = om.outlet_id
        WHERE om.user_id = auth.uid() AND o.vendor_id = vendor_event_promotions.vendor_id
      )
    )
  );

-- No UPDATE/DELETE policy for anyone — every transition (admin review, vendor
-- resubmit) goes through the SECURITY DEFINER RPCs below, which run as the
-- table owner and re-check auth.uid() themselves (ADR-002's pattern).

-- ── RPC 1: admin review (approve / reject / request_changes) ────────────

CREATE OR REPLACE FUNCTION public.review_vendor_event_promotion(
  p_promotion_id UUID,
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
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin_required';
  END IF;
  IF p_action NOT IN ('approve', 'reject', 'request_changes') THEN
    RAISE EXCEPTION 'invalid_action';
  END IF;
  IF p_action IN ('reject', 'request_changes') AND char_length(BTRIM(COALESCE(p_note, ''))) < 10 THEN
    RAISE EXCEPTION 'note_required';
  END IF;

  SELECT status INTO v_from_status
    FROM public.vendor_event_promotions
   WHERE id = p_promotion_id
     FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_from_status != 'pending' THEN RAISE EXCEPTION 'not_pending'; END IF;

  v_to_status := CASE p_action
    WHEN 'approve' THEN 'approved'
    WHEN 'reject' THEN 'rejected'
    ELSE 'changes_requested'
  END;

  UPDATE public.vendor_event_promotions
     SET status = v_to_status,
         reviewer_id = auth.uid(),
         reviewed_at = now(),
         rejection_reason = CASE WHEN p_action = 'reject' THEN BTRIM(p_note) ELSE NULL END,
         changes_requested_at = CASE WHEN p_action = 'request_changes' THEN now() ELSE NULL END,
         changes_requested_reason = CASE WHEN p_action = 'request_changes' THEN BTRIM(p_note) ELSE NULL END,
         updated_at = now()
   WHERE id = p_promotion_id;

  INSERT INTO public.vendor_event_promotion_review_events
    (promotion_id, from_status, to_status, action, actor_id, actor_role, note)
  VALUES
    (p_promotion_id, v_from_status, v_to_status, p_action, auth.uid(), 'admin', p_note);
END;
$$;

REVOKE ALL ON FUNCTION public.review_vendor_event_promotion(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_vendor_event_promotion(UUID, TEXT, TEXT) TO authenticated;

-- ── RPC 2: vendor resubmit — valid from changes_requested OR approved ────
-- `approved` (awaiting payment, not yet public) is editable; once `paid` it
-- is locked — there is no from-status branch for `paid` here at all, so a
-- paid promotion can never reach this UPDATE.

-- Drop the old event_time-based signature: CREATE OR REPLACE only replaces
-- a function with the exact same argument types, so the earlier
-- (uuid,text,text,timestamptz,text) version left over from the pre-payment
-- application (same root cause as the table shape above) is a distinct
-- overload, not replaced by the (uuid,text,text,date,date,text) version below.
DROP FUNCTION IF EXISTS public.resubmit_vendor_event_promotion(UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT);

CREATE OR REPLACE FUNCTION public.resubmit_vendor_event_promotion(
  p_promotion_id UUID,
  p_title TEXT,
  p_details TEXT,
  p_starts_on DATE,
  p_ends_on DATE,
  p_poster_url TEXT
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
BEGIN
  SELECT vendor_id, status INTO v_vendor_id, v_from_status
    FROM public.vendor_event_promotions
   WHERE id = p_promotion_id
     FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_from_status NOT IN ('changes_requested', 'approved') THEN RAISE EXCEPTION 'not_editable'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.vendors v WHERE v.id = v_vendor_id AND v.owner_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM public.outlet_managers om
    JOIN public.outlets o ON o.id = om.outlet_id
    WHERE om.user_id = auth.uid() AND o.vendor_id = v_vendor_id
  ) INTO v_is_owner;
  IF NOT v_is_owner THEN RAISE EXCEPTION 'forbidden'; END IF;

  UPDATE public.vendor_event_promotions
     SET title = p_title,
         details = p_details,
         starts_on = p_starts_on,
         ends_on = p_ends_on,
         poster_url = p_poster_url,
         status = 'pending',
         reviewer_id = NULL,
         reviewed_at = NULL,
         rejection_reason = NULL,
         changes_requested_at = NULL,
         changes_requested_reason = NULL,
         amount_sen = NULL,
         payment_method = NULL,
         stripe_checkout_session_id = NULL,
         paid_at = NULL,
         updated_at = now()
   WHERE id = p_promotion_id;

  INSERT INTO public.vendor_event_promotion_review_events
    (promotion_id, from_status, to_status, action, actor_id, actor_role, note)
  VALUES
    (p_promotion_id, v_from_status, 'pending', 'resubmit', auth.uid(), 'vendor', NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.resubmit_vendor_event_promotion(UUID, TEXT, TEXT, DATE, DATE, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resubmit_vendor_event_promotion(UUID, TEXT, TEXT, DATE, DATE, TEXT) TO authenticated;

-- ── Admin-configurable rate ───────────────────────────────────────────────
-- Same platform_settings key/value shape as commission.platform_rate — no
-- generic settings framework exists in this codebase, so this is its own row,
-- read by the payment RPC below and by the admin settings route.

INSERT INTO public.platform_settings (key, value, description)
VALUES ('event_promotion.cost_per_day_sen', '10000', 'Vendor event-promotion fee per day, in sen (default RM100.00/day).')
ON CONFLICT (key) DO NOTHING;

-- ── RPC 3: vendor pays from wallet earnings ──────────────────────────────
-- Debit pattern copied from submit_wallet_withdrawal_server
-- (20260912173000_withdrawal_trust_boundary.sql): row-lock the wallet, check
-- the balance, debit, log a wallet_transactions row + an audit_logs row — but
-- a direct one-shot debit (no reserve/release) since this is an immediate
-- purchase, not a pending-approval withdrawal. Requires status = 'approved'
-- (re-checked under the row lock), so a promotion can only ever be paid once.

CREATE OR REPLACE FUNCTION public.pay_vendor_event_promotion_from_wallet(
  p_promotion_id UUID
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_vendor_id UUID;
  v_starts_on DATE;
  v_ends_on DATE;
  v_status TEXT;
  v_is_owner BOOLEAN;
  v_cost_per_day_sen BIGINT;
  v_days BIGINT;
  v_amount_sen BIGINT;
  v_wallet RECORD;
BEGIN
  SELECT vendor_id, starts_on, ends_on, status
    INTO v_vendor_id, v_starts_on, v_ends_on, v_status
    FROM public.vendor_event_promotions
   WHERE id = p_promotion_id
     FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_status != 'approved' THEN RAISE EXCEPTION 'not_payable'; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.vendors v WHERE v.id = v_vendor_id AND v.owner_id = auth.uid()
  ) OR EXISTS (
    SELECT 1 FROM public.outlet_managers om
    JOIN public.outlets o ON o.id = om.outlet_id
    WHERE om.user_id = auth.uid() AND o.vendor_id = v_vendor_id
  ) INTO v_is_owner;
  IF NOT v_is_owner THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT COALESCE(value::BIGINT, 10000) INTO v_cost_per_day_sen
    FROM public.platform_settings WHERE key = 'event_promotion.cost_per_day_sen';
  v_days := (v_ends_on - v_starts_on) + 1;
  v_amount_sen := v_days * COALESCE(v_cost_per_day_sen, 10000);

  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'wallet_not_found'; END IF;
  IF v_wallet.earnings_sen < v_amount_sen THEN RAISE EXCEPTION 'insufficient_earnings'; END IF;

  UPDATE public.wallets
     SET earnings_sen = earnings_sen - v_amount_sen,
         updated_at = now()
   WHERE id = v_wallet.id;

  INSERT INTO public.wallet_transactions(user_id, wallet_id, type, amount_sen, bucket, direction, note)
  VALUES (auth.uid(), v_wallet.id, 'event_promotion_payment', v_amount_sen, 'earnings', 'debit',
    'Event promotion fee — ' || v_days || ' day(s)');

  UPDATE public.vendor_event_promotions
     SET status = 'paid',
         amount_sen = v_amount_sen,
         payment_method = 'wallet',
         paid_at = now(),
         updated_at = now()
   WHERE id = p_promotion_id;

  INSERT INTO public.vendor_event_promotion_review_events
    (promotion_id, from_status, to_status, action, actor_id, actor_role, note)
  VALUES
    (p_promotion_id, 'approved', 'paid', 'pay', auth.uid(), 'vendor', 'Paid from wallet earnings');

  INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, before_data, after_data, note)
  VALUES (
    auth.uid(), 'event_promotion.paid', 'vendor_event_promotion', p_promotion_id,
    jsonb_build_object('status', 'approved'),
    jsonb_build_object('status', 'paid', 'amount_sen', v_amount_sen, 'payment_method', 'wallet'),
    'Vendor paid event promotion fee from wallet earnings'
  );

  RETURN v_amount_sen;
END;
$$;

REVOKE ALL ON FUNCTION public.pay_vendor_event_promotion_from_wallet(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_vendor_event_promotion_from_wallet(UUID) TO authenticated;

-- ── RPC 4: confirm a Stripe-paid promotion (webhook only) ────────────────
-- Called from app/api/stripe/webhook/route.ts under the service-role client,
-- never directly by a user — there is no authenticated vendor session inside
-- a webhook callback, so this cannot re-check auth.uid() the way the wallet
-- RPC does. Trust boundary is the webhook's own Stripe signature verification
-- (already enforced for the whole route) plus EXECUTE being granted only to
-- service_role, not authenticated. Idempotent: a promotion can only be
-- 'approved' once, so a retried webhook call is a safe no-op on the second try.

CREATE OR REPLACE FUNCTION public.confirm_vendor_event_promotion_stripe_payment(
  p_promotion_id UUID,
  p_checkout_session_id TEXT,
  p_amount_sen BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status TEXT;
  v_submitted_by UUID;
BEGIN
  SELECT status, submitted_by INTO v_status, v_submitted_by
    FROM public.vendor_event_promotions
   WHERE id = p_promotion_id
     FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_status = 'paid' THEN RETURN; END IF; -- already confirmed — idempotent no-op
  IF v_status != 'approved' THEN RAISE EXCEPTION 'not_payable'; END IF;

  UPDATE public.vendor_event_promotions
     SET status = 'paid',
         amount_sen = p_amount_sen,
         payment_method = 'stripe',
         stripe_checkout_session_id = p_checkout_session_id,
         paid_at = now(),
         updated_at = now()
   WHERE id = p_promotion_id;

  INSERT INTO public.vendor_event_promotion_review_events
    (promotion_id, from_status, to_status, action, actor_id, actor_role, note)
  VALUES
    (p_promotion_id, 'approved', 'paid', 'pay', v_submitted_by, 'vendor', 'Paid via Stripe checkout');

  INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, before_data, after_data, note)
  VALUES (
    v_submitted_by, 'event_promotion.paid', 'vendor_event_promotion', p_promotion_id,
    jsonb_build_object('status', 'approved'),
    jsonb_build_object('status', 'paid', 'amount_sen', p_amount_sen, 'payment_method', 'stripe'),
    'Vendor paid event promotion fee via Stripe checkout'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_vendor_event_promotion_stripe_payment(UUID, TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_vendor_event_promotion_stripe_payment(UUID, TEXT, BIGINT) TO service_role;

-- ── Storage: event-posters bucket ────────────────────────────────────────
-- Public bucket (posters are meant to display publicly once approved;
-- nothing sensitive in a poster image) with vendor-scoped writes, mirroring
-- the vendor-products bucket (20260713103010): objects are stored under
-- event-posters/<vendorId>/<file>, write access checks that folder segment
-- against vendor ownership.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'event-posters',
  'event-posters',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS event_posters_public_read ON storage.objects;
CREATE POLICY event_posters_public_read ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'event-posters');

DROP POLICY IF EXISTS event_posters_insert_authorized ON storage.objects;
CREATE POLICY event_posters_insert_authorized ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'event-posters'
    AND (
      (storage.foldername(name))[1] IN (
        SELECT v.id::text FROM public.vendors v WHERE v.owner_id = auth.uid() AND v.status = 'approved'
      )
      OR EXISTS (
        SELECT 1 FROM public.outlet_managers om
        JOIN public.outlets o ON o.id = om.outlet_id
        WHERE om.user_id = auth.uid() AND o.vendor_id::text = (storage.foldername(name))[1]
      )
    )
  );

-- ── Admin nav registration (dynamic staff modules) ───────────────────────
-- The admin sidebar is entirely data-driven from staff_modules
-- (20260915222000_dynamic_staff_modules.sql) — a super_admin sees every
-- staff_modules row automatically, but every other role only sees a module
-- through an explicit staff_role_modules assignment or a
-- staff_module_legacy_roles compatibility row. This block mirrors
-- 20260925081300_add_admin_order_read_module.sql's shape exactly so the
-- Approver role (Decision 5: super_admin OR approver) sees this module too,
-- without needing a new custom staff-role template.

INSERT INTO public.staff_permissions (key, module, action, description, is_system)
VALUES ('admin.event_promotion.review', 'admin', 'event_promotions.review', 'Review vendor-submitted external event promotions', TRUE)
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
  'event_promotions', 'Event Promos', 'navigation.Event Promos',
  'Review vendor-submitted external event promotions',
  'governance', 'Governance', 'navigationSections.governance', 20,
  '/admin/event-promotions', 'megaphone', 40, TRUE
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
  JOIN public.staff_permissions AS permission ON permission.key = 'admin.event_promotion.review'
 WHERE module_row.key = 'event_promotions'
ON CONFLICT (module_id, permission_id) DO NOTHING;

-- Preserve the existing global Admin/Approver experience for this module,
-- same as every other governance module added this way.
INSERT INTO public.staff_role_permissions (role_id, permission_id)
SELECT role_row.id, permission.id
  FROM public.staff_roles AS role_row
  JOIN public.staff_permissions AS permission ON permission.key = 'admin.event_promotion.review'
 WHERE role_row.name IN ('Legacy Admin', 'Legacy Wallet Approver')
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO public.staff_role_modules (role_id, module_id)
SELECT role_row.id, module_row.id
  FROM public.staff_roles AS role_row
  JOIN public.staff_modules AS module_row ON module_row.key = 'event_promotions'
 WHERE role_row.name IN ('Legacy Admin', 'Legacy Wallet Approver')
ON CONFLICT (role_id, module_id) DO NOTHING;

INSERT INTO public.staff_module_legacy_roles (module_id, role_name, grants_permissions)
SELECT module_row.id, coarse_role_name, TRUE
  FROM public.staff_modules AS module_row, unnest(ARRAY['admin', 'approver']) AS coarse_role_name
 WHERE module_row.key = 'event_promotions'
ON CONFLICT (module_id, role_name) DO UPDATE SET grants_permissions = TRUE;
;
