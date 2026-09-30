-- Phase 3 of Docs/plans/2026-09-30-1829-event-vendor-reservations.md.
-- Vendors get a kind: 'shop' (every existing vendor) or 'event' (sells only
-- at events, never listed as a normal partner). Moved forward from Phase 4
-- so customer pages can already separate and label event partners; the
-- event-vendor role and portal still come in Phase 4.

ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'shop';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vendors_kind_check') THEN
    ALTER TABLE public.vendors ADD CONSTRAINT vendors_kind_check CHECK (kind IN ('shop', 'event'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS vendors_event_kind_idx ON public.vendors (kind) WHERE kind = 'event';

-- ── Public projection: expose the vendor kind so event partners are labelled ──
-- Same (TEXT) signature as 20260930210000 — true CREATE OR REPLACE.

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
      SELECT DISTINCT vendor.id, vendor.name, vendor.logo_url, vendor.kind
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
        'vendorKind', v_vendor.kind,
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
