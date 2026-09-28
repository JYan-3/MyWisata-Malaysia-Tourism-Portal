-- Fix: a picked product sold at multiple outlets appeared once per active
-- outlet_offer in get_public_promotion_campaigns, because outlet_offers was
-- joined with a plain LEFT JOIN. Resolve the price through a LATERAL LIMIT 1
-- (deterministic cheapest active offer), mirroring the product_media lateral
-- already used in the same function, so each product appears exactly once.
CREATE OR REPLACE FUNCTION public.get_public_promotion_campaigns(p_slug text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;
