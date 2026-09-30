-- Phase 5b of Docs/plans/2026-09-30-1829-event-vendor-reservations.md.
-- Customers show a QR at the stall; the vendor scans it and marks the
-- reservation collected. A pickup is accepted only on its pickup date
-- (Malaysia time) and only by the vendor it belongs to. Called by the vendor
-- API with the service role after authorizeVendor, like fulfil_food_order_group.

CREATE OR REPLACE FUNCTION public.fulfil_event_pickup(
  p_order_id UUID,
  p_vendor_id UUID,
  p_location_id UUID,
  p_pickup_date DATE,
  p_operator_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_status TEXT;
  v_today DATE := (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::DATE;
  v_open INTEGER;
  v_total INTEGER;
BEGIN
  SELECT lower(status) INTO v_status FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_status NOT IN ('paid', 'completed') THEN RAISE EXCEPTION 'event_pickup_not_paid'; END IF;
  IF p_pickup_date IS DISTINCT FROM v_today THEN RAISE EXCEPTION 'event_pickup_wrong_date'; END IF;

  PERFORM 1 FROM public.order_items
   WHERE order_id = p_order_id AND vendor_id = p_vendor_id
     AND event_location_id = p_location_id AND pickup_date = p_pickup_date
     AND fulfil_status <> 'cancelled'
   FOR UPDATE;

  SELECT count(*) FILTER (WHERE fulfil_status <> 'fulfilled'), count(*)
    INTO v_open, v_total
    FROM public.order_items
   WHERE order_id = p_order_id AND vendor_id = p_vendor_id
     AND event_location_id = p_location_id AND pickup_date = p_pickup_date
     AND fulfil_status <> 'cancelled';
  IF v_total = 0 THEN RAISE EXCEPTION 'event_pickup_not_found'; END IF;
  IF v_open = 0 THEN RAISE EXCEPTION 'event_pickup_already_fulfilled'; END IF;

  UPDATE public.order_items
     SET fulfil_status = 'fulfilled', fulfilled_at = now()
   WHERE order_id = p_order_id AND vendor_id = p_vendor_id
     AND event_location_id = p_location_id AND pickup_date = p_pickup_date
     AND fulfil_status IN ('pending', 'ready');

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, after_data)
  VALUES (p_operator_id, 'event_pickup.fulfilled', 'order', p_order_id,
          jsonb_build_object('vendor_id', p_vendor_id, 'location_id', p_location_id, 'pickup_date', p_pickup_date, 'items', v_open));

  RETURN jsonb_build_object('orderId', p_order_id, 'status', 'fulfilled', 'items', v_open);
END;
$$;

REVOKE ALL ON FUNCTION public.fulfil_event_pickup(UUID, UUID, UUID, DATE, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fulfil_event_pickup(UUID, UUID, UUID, DATE, UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
