-- Event listings: each item a vendor offers at an event location becomes a
-- listing with its own price, item type, daily quantity and on/off switch.
-- See Docs/plans/2026-09-30-1829-event-vendor-reservations.md (Phase 2).
--
-- Still display-only; purchasing arrives in Phase 5. Items stay out of the
-- vendor's catalog: a listing either references a catalog product (for name
-- and photo) or carries its own name and photo. Either way the price lives on
-- the listing, so there is exactly one price for checkout to trust.

ALTER TABLE public.promotion_campaign_vendor_products
  ADD COLUMN IF NOT EXISTS item_kind TEXT NOT NULL DEFAULT 'product',
  ADD COLUMN IF NOT EXISTS daily_quantity INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE public.promotion_campaign_vendor_products
  DROP CONSTRAINT IF EXISTS promotion_campaign_vendor_products_item_kind;
ALTER TABLE public.promotion_campaign_vendor_products
  ADD CONSTRAINT promotion_campaign_vendor_products_item_kind CHECK (item_kind IN ('product', 'service'));

ALTER TABLE public.promotion_campaign_vendor_products
  DROP CONSTRAINT IF EXISTS promotion_campaign_vendor_products_daily_quantity;
ALTER TABLE public.promotion_campaign_vendor_products
  ADD CONSTRAINT promotion_campaign_vendor_products_daily_quantity CHECK (daily_quantity BETWEEN 0 AND 10000);

-- The old rule required catalog-referenced items to have no price; drop it
-- before the backfill below writes one.
ALTER TABLE public.promotion_campaign_vendor_products
  DROP CONSTRAINT IF EXISTS promotion_campaign_vendor_products_source;

-- Catalog-referenced items had no stored price; customers were shown the
-- cheapest active outlet offer. Store exactly that so nothing visible changes.
UPDATE public.promotion_campaign_vendor_products vp
   SET price = COALESCE(
     (SELECT min(offer.price) FROM public.outlet_offers offer WHERE offer.product_id = vp.product_id AND offer.status = 'active'),
     (SELECT product.base_price FROM public.products product WHERE product.id = vp.product_id)
   )
 WHERE vp.product_id IS NOT NULL AND vp.price IS NULL;

ALTER TABLE public.promotion_campaign_vendor_products
  ADD CONSTRAINT promotion_campaign_vendor_products_source CHECK (
    price IS NOT NULL AND price >= 0
    AND ((product_id IS NOT NULL AND name IS NULL) OR (product_id IS NULL AND name IS NOT NULL))
  );

-- ── Shared listing writer for submit/resubmit ────────────────────────────
-- Internal only: runs inside the SECURITY DEFINER registration RPCs, which
-- have already checked the caller owns p_vendor_id.
-- Each item: {productId} or {name, imageUrl}, plus {price, dailyQuantity, itemKind}.

CREATE OR REPLACE FUNCTION public.write_campaign_listings(
  p_registration_id UUID,
  p_vendor_id UUID,
  p_products JSONB
) RETURNS VOID
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item JSONB;
  v_position INTEGER := 0;
  v_product_id UUID;
  v_price NUMERIC;
  v_quantity INTEGER;
  v_kind TEXT;
BEGIN
  IF jsonb_typeof(p_products) <> 'array' OR jsonb_array_length(p_products) < 1 OR jsonb_array_length(p_products) > 30 THEN
    RAISE EXCEPTION 'invalid_products';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_products) AS elems(value) LOOP
    BEGIN
      v_price := (v_item->>'price')::NUMERIC;
      v_quantity := (v_item->>'dailyQuantity')::INTEGER;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'invalid_product_entry';
    END;
    v_kind := COALESCE(v_item->>'itemKind', 'product');
    IF v_price IS NULL OR v_price < 0 OR v_price > 999999.99
       OR v_quantity IS NULL OR v_quantity NOT BETWEEN 0 AND 10000
       OR v_kind NOT IN ('product', 'service') THEN
      RAISE EXCEPTION 'invalid_product_entry';
    END IF;

    IF v_item ? 'productId' THEN
      v_product_id := (v_item->>'productId')::UUID;
      IF NOT EXISTS (SELECT 1 FROM public.products p WHERE p.id = v_product_id AND p.vendor_id = p_vendor_id) THEN
        RAISE EXCEPTION 'product_not_owned';
      END IF;
      INSERT INTO public.promotion_campaign_vendor_products
        (registration_id, product_id, price, item_kind, daily_quantity, position)
      VALUES (p_registration_id, v_product_id, round(v_price, 2), v_kind, v_quantity, v_position);
    ELSIF v_item ? 'name' THEN
      INSERT INTO public.promotion_campaign_vendor_products
        (registration_id, name, price, image_url, item_kind, daily_quantity, position)
      VALUES (p_registration_id, btrim(v_item->>'name'), round(v_price, 2), v_item->>'imageUrl', v_kind, v_quantity, v_position);
    ELSE
      RAISE EXCEPTION 'invalid_product_entry';
    END IF;
    v_position := v_position + 1;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.write_campaign_listings(UUID, UUID, JSONB) FROM PUBLIC, anon, authenticated, service_role;

-- ── submit: same signature as 20260930190000, now uses the shared writer ──

CREATE OR REPLACE FUNCTION public.submit_campaign_vendor_registration(
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

  IF EXISTS (SELECT 1 FROM public.promotion_campaign_vendors WHERE event_location_id = p_location_id AND vendor_id = p_vendor_id) THEN
    RAISE EXCEPTION 'already_registered';
  END IF;

  INSERT INTO public.promotion_campaign_vendors
    (campaign_id, event_location_id, vendor_id, submitted_by, stall_number, stall_description, stall_poster_url)
  VALUES
    (v_location.campaign_id, p_location_id, p_vendor_id, auth.uid(), btrim(p_stall_number), btrim(p_stall_description), p_stall_poster_url)
  RETURNING id INTO v_registration_id;

  PERFORM public.write_campaign_listings(v_registration_id, p_vendor_id, p_products);

  INSERT INTO public.promotion_campaign_vendor_review_events
    (registration_id, from_status, to_status, action, actor_id, actor_role, note)
  VALUES
    (v_registration_id, 'none', 'pending', 'submit', auth.uid(), 'vendor', NULL);

  RETURN v_registration_id;
END;
$$;

-- ── resubmit: same signature as 20260928180000, now uses the shared writer ─
-- Only reachable from changes_requested, i.e. before approval, so no listing
-- here can have been reserved yet — replacing the rows is safe.

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
  PERFORM public.write_campaign_listings(p_registration_id, v_vendor_id, p_products);

  INSERT INTO public.promotion_campaign_vendor_review_events
    (registration_id, from_status, to_status, action, actor_id, actor_role, note)
  VALUES
    (p_registration_id, v_from_status, 'pending', 'resubmit', auth.uid(), 'vendor', NULL);
END;
$$;

-- ── Vendor adjusts a listing's daily quantity or on/off switch ───────────
-- Operational stock, like the regular catalog's inventory: no re-review.
-- Price is deliberately not editable here; it stays what admin approved.

CREATE OR REPLACE FUNCTION public.update_campaign_listing(
  p_listing_id UUID,
  p_daily_quantity INTEGER,
  p_active BOOLEAN
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_vendor_id UUID;
  v_status TEXT;
  v_listing public.promotion_campaign_vendor_products%ROWTYPE;
BEGIN
  SELECT reg.vendor_id, reg.status INTO v_vendor_id, v_status
    FROM public.promotion_campaign_vendor_products vp
    JOIN public.promotion_campaign_vendors reg ON reg.id = vp.registration_id
   WHERE vp.id = p_listing_id
     FOR UPDATE OF vp;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;

  IF NOT (
    EXISTS (SELECT 1 FROM public.vendors v WHERE v.id = v_vendor_id AND v.owner_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.outlet_managers om
      JOIN public.outlets o ON o.id = om.outlet_id
     WHERE om.user_id = auth.uid() AND o.vendor_id = v_vendor_id
    )
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF v_status NOT IN ('pending', 'approved') THEN RAISE EXCEPTION 'not_editable'; END IF;
  IF p_daily_quantity IS NULL OR p_daily_quantity NOT BETWEEN 0 AND 10000 OR p_active IS NULL THEN
    RAISE EXCEPTION 'invalid_product_entry';
  END IF;

  UPDATE public.promotion_campaign_vendor_products
     SET daily_quantity = p_daily_quantity, active = p_active, updated_at = now()
   WHERE id = p_listing_id
   RETURNING * INTO v_listing;

  RETURN to_jsonb(v_listing);
END;
$$;

REVOKE ALL ON FUNCTION public.update_campaign_listing(UUID, INTEGER, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_campaign_listing(UUID, INTEGER, BOOLEAN) TO authenticated;

-- ── Public projection: listing price, item kind, hide switched-off items ──
-- Same (TEXT) signature as 20260930190000 — true CREATE OR REPLACE.

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
            vp.item_kind,
            vp.price,
            COALESCE(product.name, vp.name) AS name,
            COALESCE(product.cover_url, product_media.url, vp.image_url) AS image_url
            FROM public.promotion_campaign_vendor_products AS vp
            LEFT JOIN public.products AS product ON product.id = vp.product_id
            LEFT JOIN LATERAL (
              SELECT media.url
                FROM public.media_assets AS media
               WHERE media.product_id = product.id AND media.media_type = 'image'
               ORDER BY media.sort_order NULLS LAST, media.created_at
               LIMIT 1
            ) AS product_media ON product.id IS NOT NULL
           WHERE vp.registration_id = v_reg.id
             AND vp.active
           ORDER BY vp.position
        LOOP
          v_products := v_products || jsonb_build_array(jsonb_build_object(
            'id', v_product.id,
            'name', v_product.name,
            'kind', v_product.item_kind,
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
