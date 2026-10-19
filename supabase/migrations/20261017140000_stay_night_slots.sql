-- Phase 2 of property-first accommodation: one booking_slot = one room type for one Malaysia calendar night.
-- A night is identified by (product_id, outlet_id, starts_at); starts_at = date 15:00 MYT, ends_at = next day 12:00 MYT.
-- Money, wallet, payment, refund and settlement columns are never written. Run on a Supabase branch first.

ALTER TABLE public.cart_items
  ADD COLUMN IF NOT EXISTS nights integer NOT NULL DEFAULT 1 CHECK (nights BETWEEN 1 AND 30);
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS nights integer NOT NULL DEFAULT 1 CHECK (nights BETWEEN 1 AND 30);

-- Slot sync enqueues one outbox row per booked/status update; the rewrite must not flood it.
ALTER TABLE public.booking_slots DISABLE TRIGGER slot_outbox_enqueue;

CREATE OR REPLACE FUNCTION app_private.ensure_stay_nights(p_days integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_private
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date;
  v_inserted integer;
BEGIN
  IF p_days IS NULL OR p_days < 1 OR p_days > 730 THEN
    RAISE EXCEPTION 'invalid_stay_horizon';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('app_private.ensure_stay_nights'));

  INSERT INTO public.booking_slots (product_id, outlet_id, starts_at, ends_at, capacity, booked, status)
  SELECT pr.product_id, pr.outlet_id,
         ((v_today + g.k)::timestamp + time '15:00') AT TIME ZONE 'Asia/Kuala_Lumpur',
         ((v_today + g.k + 1)::timestamp + time '12:00') AT TIME ZONE 'Asia/Kuala_Lumpur',
         10, 0, 'available'
  FROM (
    SELECT p.id AS product_id, p.outlet_id
    FROM public.products p
    WHERE p.category_id = '11111111-0000-0000-0000-000000000008' AND p.status = 'active' AND p.outlet_id IS NOT NULL
    UNION
    SELECT p.id, oo.outlet_id
    FROM public.products p
    JOIN public.outlet_offers oo ON oo.product_id = p.id AND oo.status = 'active'
    JOIN public.outlets o ON o.id = oo.outlet_id AND o.vendor_id = p.vendor_id
    WHERE p.category_id = '11111111-0000-0000-0000-000000000008' AND p.status = 'active' AND p.outlet_id IS NULL
  ) pr
  CROSS JOIN generate_series(0, p_days) AS g(k)
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION app_private.ensure_stay_nights(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.ensure_stay_nights(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.ensure_stay_nights(p_days integer)
RETURNS integer
LANGUAGE sql
SECURITY INVOKER
AS $$ SELECT app_private.ensure_stay_nights(p_days) $$;

REVOKE ALL ON FUNCTION public.ensure_stay_nights(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_stay_nights(integer) TO service_role;

DO $$
DECLARE
  v_acc constant uuid := '11111111-0000-0000-0000-000000000008';
  v_tz constant text := 'Asia/Kuala_Lumpur';
  v_cutoff timestamptz := date_trunc('day', now() AT TIME ZONE 'Asia/Kuala_Lumpur') AT TIME ZONE 'Asia/Kuala_Lumpur';
  v_today date := (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date;
  v_refs integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('app_private.ensure_stay_nights'));
  LOCK TABLE public.booking_slots IN SHARE ROW EXCLUSIVE MODE;

  -- 2. Abort if any future accommodation slot is referenced anywhere, then delete the unreferenced ones.
  CREATE TEMP TABLE _stay_future ON COMMIT DROP AS
    SELECT s.id FROM public.booking_slots s JOIN public.products p ON p.id = s.product_id
    WHERE p.category_id = v_acc AND s.starts_at >= v_cutoff;

  SELECT (SELECT count(*) FROM public.bookings WHERE slot_id IN (SELECT id FROM _stay_future))
       + (SELECT count(*) FROM public.cart_items WHERE slot_id IN (SELECT id FROM _stay_future))
       + (SELECT count(*) FROM public.checkout_reservations WHERE slot_id IN (SELECT id FROM _stay_future))
       + (SELECT count(*) FROM public.external_reservations WHERE slot_id IN (SELECT id FROM _stay_future))
       + (SELECT count(*) FROM public.order_items WHERE slot_id IN (SELECT id FROM _stay_future))
  INTO v_refs;
  IF v_refs > 0 THEN
    RAISE EXCEPTION 'stay_night_migration_aborted: % reference(s) to future accommodation slots', v_refs;
  END IF;

  DELETE FROM public.booking_slots WHERE id IN (SELECT id FROM _stay_future);

  -- 3. Past slots: one slot per (product, outlet, MYT date); repoint all five FK consumers, merge counters.
  CREATE TEMP TABLE _stay_past ON COMMIT DROP AS
    SELECT s.id, s.product_id, s.outlet_id,
           (s.starts_at AT TIME ZONE v_tz)::date AS d,
           first_value(s.id) OVER (w ORDER BY s.starts_at, s.id) AS keeper_id,
           sum(s.booked) OVER w AS g_booked,
           sum(s.legacy_overbooked_count) OVER w AS g_legacy
    FROM public.booking_slots s JOIN public.products p ON p.id = s.product_id
    WHERE p.category_id = v_acc AND s.starts_at < v_cutoff
    WINDOW w AS (PARTITION BY s.product_id, s.outlet_id, (s.starts_at AT TIME ZONE v_tz)::date);

  UPDATE public.bookings t SET slot_id = m.keeper_id FROM _stay_past m WHERE t.slot_id = m.id AND m.id <> m.keeper_id;
  UPDATE public.cart_items t SET slot_id = m.keeper_id FROM _stay_past m WHERE t.slot_id = m.id AND m.id <> m.keeper_id;
  UPDATE public.checkout_reservations t SET slot_id = m.keeper_id FROM _stay_past m WHERE t.slot_id = m.id AND m.id <> m.keeper_id;
  UPDATE public.external_reservations t SET slot_id = m.keeper_id FROM _stay_past m WHERE t.slot_id = m.id AND m.id <> m.keeper_id;
  UPDATE public.order_items t SET slot_id = m.keeper_id FROM _stay_past m WHERE t.slot_id = m.id AND m.id <> m.keeper_id;

  DELETE FROM public.booking_slots WHERE id IN (SELECT id FROM _stay_past WHERE id <> keeper_id);

  UPDATE public.booking_slots s
  SET starts_at = (m.d::timestamp + time '15:00') AT TIME ZONE v_tz,
      ends_at = ((m.d + 1)::timestamp + time '12:00') AT TIME ZONE v_tz,
      capacity = 10,
      booked = m.g_booked,
      legacy_overbooked_count = m.g_legacy
  FROM _stay_past m
  WHERE s.id = m.keeper_id AND m.id = m.keeper_id;

  UPDATE public.order_items oi SET slot_starts_at = s.starts_at
  FROM public.booking_slots s
  WHERE oi.slot_id = s.id AND s.id IN (SELECT keeper_id FROM _stay_past);

  -- 5. Night uniqueness across all booking_slots; fail loudly rather than drop a legitimate session.
  IF EXISTS (SELECT 1 FROM public.booking_slots GROUP BY product_id, outlet_id, starts_at HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'stay_night_migration_aborted: duplicate (product_id, outlet_id, starts_at) slots exist';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_slots_product_outlet_starts_key') THEN
    ALTER TABLE public.booking_slots
      ADD CONSTRAINT booking_slots_product_outlet_starts_key UNIQUE (product_id, outlet_id, starts_at);
  END IF;

  -- 4. Valid old bookings become reproducible 1-3 night stays (never past today, never cancelled/refunded).
  PERFORM setseed(0.4217);

  CREATE TEMP TABLE _stay_old ON COMMIT DROP AS
    SELECT x.order_item_id, x.product_id, x.outlet_id, x.d, x.quantity,
           LEAST(1 + floor(random() * 3)::int, GREATEST(1, v_today - x.d)) AS nights
    FROM (
      SELECT oi.id AS order_item_id, s.product_id, s.outlet_id,
             (s.starts_at AT TIME ZONE v_tz)::date AS d, oi.quantity
      FROM public.order_items oi
      JOIN public.bookings b ON b.order_item_id = oi.id AND b.status <> 'cancelled'
      JOIN public.orders o ON o.id = oi.order_id AND o.status NOT IN ('cancelled', 'refunded')
      JOIN public.booking_slots s ON s.id = oi.slot_id
      JOIN public.products p ON p.id = s.product_id AND p.category_id = v_acc
      ORDER BY oi.id
    ) x;

  INSERT INTO public.booking_slots (product_id, outlet_id, starts_at, ends_at, capacity, booked, status)
  SELECT DISTINCT o.product_id, o.outlet_id,
         ((o.d + k)::timestamp + time '15:00') AT TIME ZONE v_tz,
         ((o.d + k + 1)::timestamp + time '12:00') AT TIME ZONE v_tz,
         10, 0, 'available'
  FROM _stay_old o CROSS JOIN LATERAL generate_series(1, o.nights - 1) AS k
  ON CONFLICT (product_id, outlet_id, starts_at) DO NOTHING;

  UPDATE public.booking_slots s SET booked = s.booked + n.qty
  FROM (
    SELECT o.product_id, o.outlet_id,
           ((o.d + k)::timestamp + time '15:00') AT TIME ZONE v_tz AS starts_at,
           sum(o.quantity)::int AS qty
    FROM _stay_old o CROSS JOIN LATERAL generate_series(1, o.nights - 1) AS k
    GROUP BY 1, 2, 3
  ) n
  WHERE s.product_id = n.product_id AND s.outlet_id = n.outlet_id AND s.starts_at = n.starts_at;

  UPDATE public.order_items oi SET nights = o.nights FROM _stay_old o WHERE oi.id = o.order_item_id;

  -- Preserve historical overflow in legacy_overbooked_count; availability only ever uses booked.
  UPDATE public.booking_slots s
  SET legacy_overbooked_count = s.legacy_overbooked_count + GREATEST(s.booked - s.capacity, 0),
      booked = LEAST(s.booked, s.capacity),
      status = CASE WHEN s.booked >= s.capacity THEN 'full' ELSE s.status END
  FROM public.products p
  WHERE p.id = s.product_id AND p.category_id = v_acc AND s.booked >= s.capacity;

  PERFORM app_private.ensure_stay_nights(180);
END;
$$;

ALTER TABLE public.booking_slots ENABLE TRIGGER slot_outbox_enqueue;

NOTIFY pgrst, 'reload schema';
