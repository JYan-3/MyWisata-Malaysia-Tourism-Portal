-- Event locations: one event (promotion_campaigns) runs at many locations,
-- each with its own dates and daily hours, and vendors register per location.
-- See Docs/plans/2026-09-30-1829-event-vendor-reservations.md (Phase 1).
--
-- Additive for existing data: every existing campaign gets one default
-- location built from its current dates and operating-hours text, and every
-- existing registration is attached to it.

-- ── promotion_campaign_locations ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.promotion_campaign_locations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.promotion_campaigns(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  address     TEXT,
  lat         DOUBLE PRECISION,
  lng         DOUBLE PRECISION,
  starts_on   DATE NOT NULL,
  ends_on     DATE NOT NULL,
  opens_at    TIME NOT NULL,
  closes_at   TIME NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT promotion_campaign_locations_id_campaign_unique UNIQUE (id, campaign_id),
  CONSTRAINT promotion_campaign_locations_name_length CHECK (char_length(btrim(name)) BETWEEN 2 AND 120),
  CONSTRAINT promotion_campaign_locations_address_length CHECK (address IS NULL OR char_length(btrim(address)) BETWEEN 3 AND 300),
  CONSTRAINT promotion_campaign_locations_coords CHECK (
    (lat IS NULL AND lng IS NULL)
    OR (lat IS NOT NULL AND lng IS NOT NULL AND lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180)
  ),
  CONSTRAINT promotion_campaign_locations_dates CHECK (ends_on >= starts_on),
  -- ponytail: same-day hours only; an overnight stall (e.g. 6pm-2am) must close at 23:59 until overnight windows are needed.
  CONSTRAINT promotion_campaign_locations_hours CHECK (closes_at > opens_at)
);

CREATE INDEX IF NOT EXISTS promotion_campaign_locations_campaign_idx
  ON public.promotion_campaign_locations (campaign_id, starts_on);

ALTER TABLE public.promotion_campaign_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS promotion_campaign_locations_admin_select ON public.promotion_campaign_locations;
CREATE POLICY promotion_campaign_locations_admin_select ON public.promotion_campaign_locations
  FOR SELECT TO authenticated
  USING (public.has_staff_permission(auth.uid(), 'admin.promotion_campaign.manage'));

-- Public/vendor reads go through get_public_promotion_campaigns; writes only
-- through the SECURITY DEFINER RPCs below (ADR-002).
REVOKE ALL ON TABLE public.promotion_campaign_locations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.promotion_campaign_locations TO authenticated, service_role;

-- ── Backfill: one default location per existing campaign ────────────────

INSERT INTO public.promotion_campaign_locations (campaign_id, name, starts_on, ends_on, opens_at, closes_at)
SELECT c.id,
       'Main location',
       (c.starts_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date,
       GREATEST((c.ends_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date, (c.starts_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date),
       CASE WHEN h.open_at IS NOT NULL AND h.close_at > h.open_at THEN h.open_at ELSE TIME '10:00' END,
       CASE WHEN h.open_at IS NOT NULL AND h.close_at > h.open_at THEN h.close_at ELSE TIME '22:00' END
  FROM public.promotion_campaigns c
  LEFT JOIN LATERAL (
    SELECT make_time((m[1]::INT % 12) + CASE WHEN upper(m[3]) = 'PM' THEN 12 ELSE 0 END, m[2]::INT, 0) AS open_at,
           make_time((m[4]::INT % 12) + CASE WHEN upper(m[6]) = 'PM' THEN 12 ELSE 0 END, m[5]::INT, 0) AS close_at
      FROM (SELECT regexp_match(COALESCE(c.operating_hours, ''), '(\d{1,2}):(\d{2})\s*(AM|PM)\s*[–-]\s*(\d{1,2}):(\d{2})\s*(AM|PM)', 'i') AS m) parsed
     WHERE m IS NOT NULL
  ) h ON TRUE
 WHERE NOT EXISTS (SELECT 1 FROM public.promotion_campaign_locations l WHERE l.campaign_id = c.id);

-- ── Registrations become per location ────────────────────────────────────

ALTER TABLE public.promotion_campaign_vendors
  ADD COLUMN IF NOT EXISTS event_location_id UUID;

UPDATE public.promotion_campaign_vendors reg
   SET event_location_id = (
     SELECT l.id FROM public.promotion_campaign_locations l
      WHERE l.campaign_id = reg.campaign_id
      ORDER BY l.starts_on, l.created_at
      LIMIT 1
   )
 WHERE reg.event_location_id IS NULL;

ALTER TABLE public.promotion_campaign_vendors
  ALTER COLUMN event_location_id SET NOT NULL;

-- Composite FK: a registration's location must belong to the same campaign.
ALTER TABLE public.promotion_campaign_vendors
  DROP CONSTRAINT IF EXISTS promotion_campaign_vendors_location_fkey;
ALTER TABLE public.promotion_campaign_vendors
  ADD CONSTRAINT promotion_campaign_vendors_location_fkey
  FOREIGN KEY (event_location_id, campaign_id)
  REFERENCES public.promotion_campaign_locations (id, campaign_id);

ALTER TABLE public.promotion_campaign_vendors
  DROP CONSTRAINT IF EXISTS promotion_campaign_vendors_unique;
ALTER TABLE public.promotion_campaign_vendors
  DROP CONSTRAINT IF EXISTS promotion_campaign_vendors_location_vendor_unique;
ALTER TABLE public.promotion_campaign_vendors
  ADD CONSTRAINT promotion_campaign_vendors_location_vendor_unique UNIQUE (event_location_id, vendor_id);

CREATE INDEX IF NOT EXISTS promotion_campaign_vendors_location_idx
  ON public.promotion_campaign_vendors (event_location_id, status);

-- ── RPC: admin creates/updates a location ────────────────────────────────

CREATE OR REPLACE FUNCTION public.save_promotion_campaign_location(
  p_campaign_id UUID,
  p_location_id UUID,
  p_name TEXT,
  p_address TEXT,
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_starts_on DATE,
  p_ends_on DATE,
  p_opens_at TIME,
  p_closes_at TIME
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_campaign public.promotion_campaigns%ROWTYPE;
  v_before JSONB;
  v_location public.promotion_campaign_locations%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR NOT public.has_staff_permission(v_actor, 'admin.promotion_campaign.manage') THEN
    RAISE EXCEPTION 'promotion_campaign_permission_required';
  END IF;

  SELECT * INTO v_campaign FROM public.promotion_campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'promotion_campaign_not_found'; END IF;
  IF v_campaign.status = 'archived' THEN RAISE EXCEPTION 'promotion_campaign_invalid_transition'; END IF;

  IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 2 AND 120
     OR (p_address IS NOT NULL AND char_length(btrim(p_address)) NOT BETWEEN 3 AND 300)
     OR ((p_lat IS NULL) <> (p_lng IS NULL))
     OR (p_lat IS NOT NULL AND (p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180))
     OR p_starts_on IS NULL OR p_ends_on IS NULL OR p_ends_on < p_starts_on
     OR p_opens_at IS NULL OR p_closes_at IS NULL OR p_closes_at <= p_opens_at THEN
    RAISE EXCEPTION 'promotion_campaign_location_invalid';
  END IF;

  IF p_starts_on < (v_campaign.starts_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date
     OR p_ends_on > (v_campaign.ends_at AT TIME ZONE 'Asia/Kuala_Lumpur')::date THEN
    RAISE EXCEPTION 'promotion_campaign_location_outside_event';
  END IF;

  IF p_location_id IS NULL THEN
    INSERT INTO public.promotion_campaign_locations
      (campaign_id, name, address, lat, lng, starts_on, ends_on, opens_at, closes_at)
    VALUES
      (p_campaign_id, btrim(p_name), NULLIF(btrim(p_address), ''), p_lat, p_lng, p_starts_on, p_ends_on, p_opens_at, p_closes_at)
    RETURNING * INTO v_location;
  ELSE
    SELECT * INTO v_location FROM public.promotion_campaign_locations
     WHERE id = p_location_id AND campaign_id = p_campaign_id
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'promotion_campaign_location_not_found'; END IF;
    v_before := to_jsonb(v_location);
    UPDATE public.promotion_campaign_locations
       SET name = btrim(p_name), address = NULLIF(btrim(p_address), ''), lat = p_lat, lng = p_lng,
           starts_on = p_starts_on, ends_on = p_ends_on, opens_at = p_opens_at, closes_at = p_closes_at,
           updated_at = now()
     WHERE id = p_location_id
     RETURNING * INTO v_location;
  END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data, note)
  VALUES (v_actor, 'promotion_campaign_location.save', 'promotion_campaign_location', v_location.id, v_before, to_jsonb(v_location), NULL);

  RETURN to_jsonb(v_location);
END;
$$;

REVOKE ALL ON FUNCTION public.save_promotion_campaign_location(UUID, UUID, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DATE, DATE, TIME, TIME) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_promotion_campaign_location(UUID, UUID, TEXT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DATE, DATE, TIME, TIME) TO authenticated;

-- ── RPC: admin deletes a location ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.delete_promotion_campaign_location(p_location_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_location public.promotion_campaign_locations%ROWTYPE;
  v_campaign_status TEXT;
BEGIN
  IF v_actor IS NULL OR NOT public.has_staff_permission(v_actor, 'admin.promotion_campaign.manage') THEN
    RAISE EXCEPTION 'promotion_campaign_permission_required';
  END IF;

  SELECT * INTO v_location FROM public.promotion_campaign_locations WHERE id = p_location_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'promotion_campaign_location_not_found'; END IF;

  IF EXISTS (SELECT 1 FROM public.promotion_campaign_vendors WHERE event_location_id = p_location_id) THEN
    RAISE EXCEPTION 'promotion_campaign_location_in_use';
  END IF;

  SELECT status INTO v_campaign_status FROM public.promotion_campaigns WHERE id = v_location.campaign_id FOR UPDATE;
  IF v_campaign_status NOT IN ('draft', 'rejected')
     AND NOT EXISTS (SELECT 1 FROM public.promotion_campaign_locations WHERE campaign_id = v_location.campaign_id AND id <> p_location_id) THEN
    RAISE EXCEPTION 'promotion_campaign_location_required';
  END IF;

  DELETE FROM public.promotion_campaign_locations WHERE id = p_location_id;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, before_data, after_data, note)
  VALUES (v_actor, 'promotion_campaign_location.delete', 'promotion_campaign_location', p_location_id, to_jsonb(v_location), NULL, NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_promotion_campaign_location(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_promotion_campaign_location(UUID) TO authenticated;

-- ── Publishing requires at least one location ────────────────────────────
-- Same (UUID, TEXT, TIMESTAMPTZ, TEXT) signature as 20260928210000 — true
-- CREATE OR REPLACE; only the location check is new.

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

  IF p_action IN ('submit', 'approve', 'resume')
     AND NOT EXISTS (SELECT 1 FROM public.promotion_campaign_locations WHERE campaign_id = v_campaign.id) THEN
    RAISE EXCEPTION 'promotion_campaign_location_required';
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

-- ── RPC: vendor registers for a location ─────────────────────────────────
-- Parameter renamed (p_campaign_id -> p_location_id) with identical types, so
-- CREATE OR REPLACE would fail; drop the old function first.

DROP FUNCTION IF EXISTS public.submit_campaign_vendor_registration(UUID, UUID, TEXT, TEXT, TEXT, JSONB);

CREATE FUNCTION public.submit_campaign_vendor_registration(
  p_location_id UUID,
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
  v_location public.promotion_campaign_locations%ROWTYPE;
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

  SELECT * INTO v_location FROM public.promotion_campaign_locations WHERE id = p_location_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
  SELECT * INTO v_campaign FROM public.promotion_campaigns WHERE id = v_location.campaign_id;
  IF v_campaign.status <> 'approved' OR v_campaign.ends_at <= now()
     OR v_location.ends_on < (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date THEN
    RAISE EXCEPTION 'campaign_not_open';
  END IF;

  IF char_length(btrim(COALESCE(p_stall_number, ''))) NOT BETWEEN 1 AND 40 THEN RAISE EXCEPTION 'invalid_stall_number'; END IF;
  IF char_length(btrim(COALESCE(p_stall_description, ''))) NOT BETWEEN 10 AND 2000 THEN RAISE EXCEPTION 'invalid_stall_description'; END IF;
  IF p_stall_poster_url IS NULL OR btrim(p_stall_poster_url) = '' THEN RAISE EXCEPTION 'poster_required'; END IF;
  IF jsonb_typeof(p_products) <> 'array' OR jsonb_array_length(p_products) < 1 OR jsonb_array_length(p_products) > 30 THEN
    RAISE EXCEPTION 'invalid_products';
  END IF;

  IF EXISTS (SELECT 1 FROM public.promotion_campaign_vendors WHERE event_location_id = p_location_id AND vendor_id = p_vendor_id) THEN
    RAISE EXCEPTION 'already_registered';
  END IF;

  INSERT INTO public.promotion_campaign_vendors
    (campaign_id, event_location_id, vendor_id, submitted_by, stall_number, stall_description, stall_poster_url)
  VALUES
    (v_location.campaign_id, p_location_id, p_vendor_id, auth.uid(), btrim(p_stall_number), btrim(p_stall_description), p_stall_poster_url)
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

-- ── Public projection: locations + vendors grouped with per-location stalls ─
-- Same (TEXT) signature as 20260928190000 — true CREATE OR REPLACE. Each
-- vendor appears once with one stall per approved location registration, so
-- vendor counts stay distinct. Product resolution is unchanged from 190000.

CREATE OR REPLACE FUNCTION public.get_public_promotion_campaigns(p_slug text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_campaign RECORD;
  v_vendor RECORD;
  v_reg RECORD;
  v_product RECORD;
  v_products JSONB;
  v_stalls JSONB;
  v_vendors JSONB;
  v_locations JSONB;
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
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', l.id,
             'name', l.name,
             'address', l.address,
             'lat', l.lat,
             'lng', l.lng,
             'startsOn', l.starts_on,
             'endsOn', l.ends_on,
             'opensAt', to_char(l.opens_at, 'HH24:MI'),
             'closesAt', to_char(l.closes_at, 'HH24:MI')
           ) ORDER BY l.starts_on, l.name), '[]'::JSONB)
      INTO v_locations
      FROM public.promotion_campaign_locations l
     WHERE l.campaign_id = v_campaign.id;

    v_vendors := '[]'::JSONB;

    FOR v_vendor IN
      SELECT DISTINCT vendor.id, vendor.name, vendor.logo_url
        FROM public.promotion_campaign_vendors AS reg
        JOIN public.vendors AS vendor ON vendor.id = reg.vendor_id
       WHERE reg.campaign_id = v_campaign.id
         AND reg.status = 'approved'
         AND vendor.status = 'approved'
       ORDER BY vendor.name
    LOOP
      v_stalls := '[]'::JSONB;

      FOR v_reg IN
        SELECT reg.*
          FROM public.promotion_campaign_vendors AS reg
          JOIN public.promotion_campaign_locations AS l ON l.id = reg.event_location_id
         WHERE reg.campaign_id = v_campaign.id
           AND reg.vendor_id = v_vendor.id
           AND reg.status = 'approved'
         ORDER BY l.starts_on, l.name
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
            LEFT JOIN LATERAL (
              SELECT offer.price
                FROM public.outlet_offers AS offer
               WHERE offer.product_id = product.id AND offer.status = 'active'
               ORDER BY offer.price ASC
               LIMIT 1
            ) AS outlet_offer ON product.id IS NOT NULL
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

        v_stalls := v_stalls || jsonb_build_array(jsonb_build_object(
          'registrationId', v_reg.id,
          'locationId', v_reg.event_location_id,
          'stallNumber', v_reg.stall_number,
          'stallDescription', v_reg.stall_description,
          'stallPosterUrl', v_reg.stall_poster_url,
          'products', v_products
        ));
      END LOOP;

      v_vendors := v_vendors || jsonb_build_array(jsonb_build_object(
        'vendorId', v_vendor.id,
        'vendorName', v_vendor.name,
        'vendorLogoUrl', v_vendor.logo_url,
        'stalls', v_stalls
      ));
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
      'locations', v_locations,
      'vendors', v_vendors
    ));
  END LOOP;

  RETURN v_result;
END;
$function$;

NOTIFY pgrst, 'reload schema';
