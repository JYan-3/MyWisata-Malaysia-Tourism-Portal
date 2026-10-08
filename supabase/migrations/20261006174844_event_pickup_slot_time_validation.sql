-- Bind newly issued event pickup QRs to a saved slot and enforce the start
-- time again inside the atomic fulfilment transaction. Existing date-only
-- tokens pass NULL and are accepted only after every open slot has started.

DROP FUNCTION IF EXISTS public.fulfil_event_pickup(UUID, UUID, UUID, DATE, UUID);

CREATE FUNCTION public.fulfil_event_pickup(
  p_order_id UUID,
  p_vendor_id UUID,
  p_location_id UUID,
  p_pickup_date DATE,
  p_pickup_slot_id UUID,
  p_operator_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_status TEXT;
  v_now TIMESTAMPTZ;
  v_today DATE;
  v_total INTEGER;
  v_open INTEGER;
  v_missing_time INTEGER;
  v_future_time INTEGER;
  v_pickup_times JSONB;
  v_item_details JSONB;
BEGIN
  SELECT lower(status) INTO v_status
    FROM public.orders
   WHERE id = p_order_id
   FOR UPDATE;
  IF NOT FOUND OR v_status NOT IN ('paid', 'completed') THEN
    RAISE EXCEPTION 'event_pickup_not_paid';
  END IF;
  -- Read the database clock after acquiring the order lock so a concurrent
  -- scan that waits across midnight cannot use a stale Malaysia pickup date.
  v_now := clock_timestamp();
  v_today := (v_now AT TIME ZONE 'Asia/Kuala_Lumpur')::DATE;
  IF p_pickup_date IS DISTINCT FROM v_today THEN
    RAISE EXCEPTION 'event_pickup_wrong_date';
  END IF;

  -- Lock every line this code can fulfil before checking state and time. The
  -- order lock above serializes concurrent scans of separate slots as well.
  PERFORM 1
    FROM public.order_items
   WHERE order_id = p_order_id
     AND vendor_id = p_vendor_id
     AND event_location_id = p_location_id
     AND pickup_date = p_pickup_date
     AND (p_pickup_slot_id IS NULL OR pickup_slot_id = p_pickup_slot_id)
     AND fulfil_status <> 'cancelled'
   FOR UPDATE;

  SELECT count(*),
         count(*) FILTER (WHERE fulfil_status IN ('pending', 'ready')),
         count(*) FILTER (WHERE fulfil_status IN ('pending', 'ready') AND slot_starts_at IS NULL),
         count(*) FILTER (WHERE fulfil_status IN ('pending', 'ready') AND slot_starts_at > v_now)
    INTO v_total, v_open, v_missing_time, v_future_time
    FROM public.order_items
   WHERE order_id = p_order_id
     AND vendor_id = p_vendor_id
     AND event_location_id = p_location_id
     AND pickup_date = p_pickup_date
     AND (p_pickup_slot_id IS NULL OR pickup_slot_id = p_pickup_slot_id)
     AND fulfil_status <> 'cancelled';

  IF v_total = 0 THEN RAISE EXCEPTION 'event_pickup_not_found'; END IF;
  IF v_open = 0 THEN RAISE EXCEPTION 'event_pickup_already_fulfilled'; END IF;
  IF v_missing_time > 0 THEN RAISE EXCEPTION 'event_pickup_time_unavailable'; END IF;
  IF v_future_time > 0 THEN RAISE EXCEPTION 'event_pickup_not_yet'; END IF;

  SELECT COALESCE(jsonb_agg(slot_times.slot_starts_at ORDER BY slot_times.slot_starts_at), '[]'::JSONB)
    INTO v_pickup_times
    FROM (
      SELECT DISTINCT slot_starts_at::TEXT AS slot_starts_at
        FROM public.order_items
       WHERE order_id = p_order_id
         AND vendor_id = p_vendor_id
         AND event_location_id = p_location_id
         AND pickup_date = p_pickup_date
         AND (p_pickup_slot_id IS NULL OR pickup_slot_id = p_pickup_slot_id)
         AND fulfil_status IN ('pending', 'ready')
    ) AS slot_times;

  SELECT COALESCE(
           jsonb_agg(
             jsonb_build_object('name', product_name, 'variant', variant_name, 'quantity', quantity)
             ORDER BY product_name, id
           ),
           '[]'::JSONB
         )
    INTO v_item_details
    FROM public.order_items
   WHERE order_id = p_order_id
     AND vendor_id = p_vendor_id
     AND event_location_id = p_location_id
     AND pickup_date = p_pickup_date
     AND (p_pickup_slot_id IS NULL OR pickup_slot_id = p_pickup_slot_id)
     AND fulfil_status IN ('pending', 'ready');

  UPDATE public.order_items
     SET fulfil_status = 'fulfilled', fulfilled_at = v_now
   WHERE order_id = p_order_id
     AND vendor_id = p_vendor_id
     AND event_location_id = p_location_id
     AND pickup_date = p_pickup_date
     AND (p_pickup_slot_id IS NULL OR pickup_slot_id = p_pickup_slot_id)
     AND fulfil_status IN ('pending', 'ready');

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, after_data)
  VALUES (
    p_operator_id,
    'event_pickup.fulfilled',
    'order',
    p_order_id,
    jsonb_build_object(
      'vendor_id', p_vendor_id,
      'location_id', p_location_id,
      'pickup_date', p_pickup_date,
      'pickup_slot_id', p_pickup_slot_id,
      'pickup_times', v_pickup_times,
      'item_details', v_item_details,
      'items', v_open
    )
  );

  RETURN jsonb_build_object(
    'orderId', p_order_id,
    'status', 'fulfilled',
    'items', v_open,
    'pickupSlotId', p_pickup_slot_id,
    'pickupTimes', v_pickup_times,
    'itemDetails', v_item_details
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fulfil_event_pickup(UUID, UUID, UUID, DATE, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfil_event_pickup(UUID, UUID, UUID, DATE, UUID, UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
