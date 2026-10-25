CREATE OR REPLACE FUNCTION app_private.guest_contact_correction_blocker(p_order_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1 FROM public.digital_entitlements AS entitlement
      WHERE entitlement.order_id = p_order_id
    ) THEN 'fulfilment_credential_reissue_required'
    WHEN EXISTS (
      SELECT 1
      FROM public.order_items AS item
      LEFT JOIN public.products AS product ON product.id = item.product_id
      WHERE item.order_id = p_order_id
        AND item.fulfil_status <> 'cancelled'
        AND (
          item.food_fulfilment_mode IS NOT NULL
          OR item.event_listing_id IS NOT NULL
          OR item.event_location_id IS NOT NULL
          OR product.id IS NULL
          OR product.product_type = 'digital'
          OR (product.product_type IS NOT NULL AND product.product_type NOT IN ('activity','experience','food','product','service','digital'))
        )
    ) THEN 'fulfilment_credential_reissue_required'
    WHEN EXISTS (
      SELECT 1 FROM public.bookings AS booking
      JOIN public.order_items AS item ON item.id = booking.order_item_id
      WHERE item.order_id = p_order_id AND booking.status IN ('confirmed','in_use')
    ) THEN 'fulfilment_credential_reissue_required'
    WHEN EXISTS (
      SELECT 1 FROM public.ticket_passes AS pass
      JOIN public.order_items AS item ON item.id = pass.order_item_id
      WHERE item.order_id = p_order_id
        AND pass.status = 'active' AND pass.entries_used < pass.entry_limit
        AND (pass.valid_from IS NULL OR pass.valid_from <= now())
        AND (pass.valid_until IS NULL OR pass.valid_until > now())
    ) THEN 'fulfilment_credential_reissue_required'
    ELSE NULL
  END;
$function$;
