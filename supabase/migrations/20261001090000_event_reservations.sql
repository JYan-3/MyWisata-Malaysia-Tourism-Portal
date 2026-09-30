-- Phase 5a of Docs/plans/2026-09-30-1829-event-vendor-reservations.md.
-- Customers reserve event items for a pickup date and a vendor-defined time
-- slot, and pay in full (RM0 = free reservation), through a checkout that is
-- separate from the cart but reuses orders, payments, checkout sessions and
-- finalize_checkout.
--
-- Stock is counted from active checkout holds (kind 'event') instead of a
-- counter, so finalize_checkout's existing commit/release handling and
-- session expiry keep it correct without changes: a held unit stops counting
-- the moment its session expires, even before the expiry job runs.

-- ── Pickup slots: per vendor-at-location, every day or one extra date ──────

CREATE TABLE IF NOT EXISTS public.promotion_campaign_pickup_slots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id UUID NOT NULL REFERENCES public.promotion_campaign_vendors(id) ON DELETE CASCADE,
  -- NULL = offered every day of the location; a date = an extra slot on that day only.
  slot_date       DATE,
  starts_at       TIME NOT NULL,
  ends_at         TIME NOT NULL,
  -- Maximum items across all reservations in this slot on one day.
  capacity        INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 10000),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT promotion_campaign_pickup_slots_window CHECK (ends_at > starts_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS promotion_campaign_pickup_slots_unique
  ON public.promotion_campaign_pickup_slots (registration_id, COALESCE(slot_date, DATE '0001-01-01'), starts_at, ends_at);

-- Owner or outlet manager of the vendor (same rule as update_campaign_listing).
CREATE OR REPLACE FUNCTION public.can_manage_vendor_events(p_vendor_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.vendors v WHERE v.id = p_vendor_id AND v.owner_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.outlet_managers om
      JOIN public.outlets o ON o.id = om.outlet_id
     WHERE om.user_id = auth.uid() AND o.vendor_id = p_vendor_id
    )
  );
$$;

REVOKE ALL ON FUNCTION public.can_manage_vendor_events(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_vendor_events(UUID) TO authenticated, service_role;

ALTER TABLE public.promotion_campaign_pickup_slots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS promotion_campaign_pickup_slots_vendor_read ON public.promotion_campaign_pickup_slots;
CREATE POLICY promotion_campaign_pickup_slots_vendor_read ON public.promotion_campaign_pickup_slots
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.promotion_campaign_vendors reg
     WHERE reg.id = registration_id
       AND (public.can_manage_vendor_events(reg.vendor_id) OR public.has_staff_permission(auth.uid(), 'admin.vendor.manage'))
  ));

GRANT SELECT ON public.promotion_campaign_pickup_slots TO authenticated;
GRANT ALL ON public.promotion_campaign_pickup_slots TO service_role;

-- ── Order lines and holds for event reservations ───────────────────────────

ALTER TABLE public.order_items
  ALTER COLUMN outlet_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS event_listing_id UUID REFERENCES public.promotion_campaign_vendor_products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS event_location_id UUID REFERENCES public.promotion_campaign_locations(id),
  ADD COLUMN IF NOT EXISTS pickup_date DATE,
  ADD COLUMN IF NOT EXISTS pickup_slot_id UUID REFERENCES public.promotion_campaign_pickup_slots(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_items_outlet_or_event') THEN
    -- Every line is sold either at an outlet or at an event location on a pickup date.
    ALTER TABLE public.order_items ADD CONSTRAINT order_items_outlet_or_event CHECK (
      outlet_id IS NOT NULL
      OR (event_location_id IS NOT NULL AND pickup_date IS NOT NULL)
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS order_items_event_pickup_idx
  ON public.order_items (vendor_id, event_location_id, pickup_date)
  WHERE event_location_id IS NOT NULL;

ALTER TABLE public.checkout_reservations
  ADD COLUMN IF NOT EXISTS event_listing_id UUID REFERENCES public.promotion_campaign_vendor_products(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS pickup_date DATE,
  ADD COLUMN IF NOT EXISTS pickup_slot_id UUID REFERENCES public.promotion_campaign_pickup_slots(id) ON DELETE CASCADE;

ALTER TABLE public.checkout_reservations DROP CONSTRAINT IF EXISTS checkout_reservations_kind_check;
ALTER TABLE public.checkout_reservations ADD CONSTRAINT checkout_reservations_kind_check
  CHECK ((kind)::text = ANY ((ARRAY['inventory', 'booking', 'event'])::text[]));

ALTER TABLE public.checkout_reservations DROP CONSTRAINT IF EXISTS checkout_reservations_check;
ALTER TABLE public.checkout_reservations ADD CONSTRAINT checkout_reservations_check CHECK (
  ((kind)::text = 'inventory' AND variant_id IS NOT NULL AND slot_id IS NULL AND event_listing_id IS NULL)
  OR ((kind)::text = 'booking' AND slot_id IS NOT NULL AND variant_id IS NULL AND event_listing_id IS NULL)
  OR ((kind)::text = 'event' AND event_listing_id IS NOT NULL AND pickup_date IS NOT NULL AND pickup_slot_id IS NOT NULL
      AND variant_id IS NULL AND slot_id IS NULL)
);

CREATE INDEX IF NOT EXISTS checkout_reservations_event_listing_idx
  ON public.checkout_reservations (event_listing_id, pickup_date) WHERE kind = 'event';
CREATE INDEX IF NOT EXISTS checkout_reservations_event_slot_idx
  ON public.checkout_reservations (pickup_slot_id, pickup_date) WHERE kind = 'event';

-- Units taken: committed holds, plus held ones whose checkout has not expired.
CREATE OR REPLACE FUNCTION public.event_units_taken(p_listing_id UUID, p_slot_id UUID, p_pickup_date DATE)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT COALESCE(SUM(r.quantity), 0)::INTEGER
    FROM public.checkout_reservations r
    JOIN public.checkout_sessions s ON s.id = r.checkout_session_id
   WHERE r.kind = 'event'
     AND r.pickup_date = p_pickup_date
     AND (p_listing_id IS NULL OR r.event_listing_id = p_listing_id)
     AND (p_slot_id IS NULL OR r.pickup_slot_id = p_slot_id)
     AND (r.status = 'committed' OR (r.status = 'held' AND s.expires_at > now()));
$$;

REVOKE ALL ON FUNCTION public.event_units_taken(UUID, UUID, DATE) FROM PUBLIC, anon, authenticated;

-- ── Vendor: save / delete pickup slots ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.save_event_pickup_slot(
  p_registration_id UUID,
  p_slot_id UUID,
  p_slot_date DATE,
  p_starts_at TIME,
  p_ends_at TIME,
  p_capacity INTEGER
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_reg public.promotion_campaign_vendors%ROWTYPE;
  v_location public.promotion_campaign_locations%ROWTYPE;
  v_slot public.promotion_campaign_pickup_slots%ROWTYPE;
BEGIN
  SELECT * INTO v_reg FROM public.promotion_campaign_vendors WHERE id = p_registration_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT public.can_manage_vendor_events(v_reg.vendor_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v_reg.status NOT IN ('pending', 'approved') THEN RAISE EXCEPTION 'not_editable'; END IF;

  SELECT * INTO v_location FROM public.promotion_campaign_locations WHERE id = v_reg.event_location_id;
  IF p_starts_at IS NULL OR p_ends_at IS NULL OR p_ends_at <= p_starts_at
     OR p_capacity IS NULL OR p_capacity NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION 'pickup_slot_invalid';
  END IF;
  IF p_starts_at < v_location.opens_at OR p_ends_at > v_location.closes_at THEN
    RAISE EXCEPTION 'pickup_slot_outside_hours';
  END IF;
  IF p_slot_date IS NOT NULL AND (p_slot_date < v_location.starts_on OR p_slot_date > v_location.ends_on) THEN
    RAISE EXCEPTION 'pickup_slot_outside_dates';
  END IF;

  BEGIN
    IF p_slot_id IS NULL THEN
      INSERT INTO public.promotion_campaign_pickup_slots (registration_id, slot_date, starts_at, ends_at, capacity)
      VALUES (p_registration_id, p_slot_date, p_starts_at, p_ends_at, p_capacity)
      RETURNING * INTO v_slot;
    ELSE
      UPDATE public.promotion_campaign_pickup_slots
         SET slot_date = p_slot_date, starts_at = p_starts_at, ends_at = p_ends_at, capacity = p_capacity, updated_at = now()
       WHERE id = p_slot_id AND registration_id = p_registration_id
       RETURNING * INTO v_slot;
      IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'pickup_slot_duplicate';
  END;

  RETURN to_jsonb(v_slot);
END;
$$;

REVOKE ALL ON FUNCTION public.save_event_pickup_slot(UUID, UUID, DATE, TIME, TIME, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_event_pickup_slot(UUID, UUID, DATE, TIME, TIME, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_event_pickup_slot(p_slot_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_vendor_id UUID;
BEGIN
  SELECT reg.vendor_id INTO v_vendor_id
    FROM public.promotion_campaign_pickup_slots s
    JOIN public.promotion_campaign_vendors reg ON reg.id = s.registration_id
   WHERE s.id = p_slot_id
     FOR UPDATE OF s;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT public.can_manage_vendor_events(v_vendor_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  -- Customers already hold this slot: keep it so their pickup time stays valid.
  IF EXISTS (
    SELECT 1 FROM public.checkout_reservations r
      JOIN public.checkout_sessions s ON s.id = r.checkout_session_id
     WHERE r.kind = 'event' AND r.pickup_slot_id = p_slot_id
       AND (r.status = 'committed' OR (r.status = 'held' AND s.expires_at > now()))
  ) THEN
    RAISE EXCEPTION 'pickup_slot_in_use';
  END IF;
  DELETE FROM public.promotion_campaign_pickup_slots WHERE id = p_slot_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_event_pickup_slot(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_event_pickup_slot(UUID) TO authenticated;

-- ── Public: slots and remaining stock for one stall on one date ────────────

CREATE OR REPLACE FUNCTION public.get_event_pickup_availability(p_registration_id UUID, p_pickup_date DATE)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_reg public.promotion_campaign_vendors%ROWTYPE;
  v_location public.promotion_campaign_locations%ROWTYPE;
  v_today DATE := (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::DATE;
  v_now_time TIME := (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::TIME;
BEGIN
  SELECT reg.* INTO v_reg
    FROM public.promotion_campaign_vendors reg
    JOIN public.promotion_campaigns c ON c.id = reg.campaign_id
    JOIN public.vendors v ON v.id = reg.vendor_id
   WHERE reg.id = p_registration_id
     AND reg.status = 'approved' AND c.status = 'approved' AND c.ends_at > now() AND v.status = 'approved';
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;

  SELECT * INTO v_location FROM public.promotion_campaign_locations WHERE id = v_reg.event_location_id;
  IF p_pickup_date IS NULL OR p_pickup_date < GREATEST(v_location.starts_on, v_today) OR p_pickup_date > v_location.ends_on THEN
    RETURN jsonb_build_object('date', p_pickup_date, 'slots', '[]'::JSONB, 'items', '[]'::JSONB);
  END IF;

  RETURN jsonb_build_object(
    'date', p_pickup_date,
    'slots', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', s.id,
               'startsAt', to_char(s.starts_at, 'HH24:MI'),
               'endsAt', to_char(s.ends_at, 'HH24:MI'),
               'remaining', GREATEST(0, s.capacity - public.event_units_taken(NULL, s.id, p_pickup_date))
             ) ORDER BY s.starts_at, s.ends_at)
        FROM public.promotion_campaign_pickup_slots s
       WHERE s.registration_id = v_reg.id
         AND (s.slot_date IS NULL OR s.slot_date = p_pickup_date)
         AND NOT (p_pickup_date = v_today AND s.ends_at <= v_now_time)
    ), '[]'::JSONB),
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', vp.id,
               'remaining', GREATEST(0, vp.daily_quantity - public.event_units_taken(vp.id, NULL, p_pickup_date))
             ) ORDER BY vp.position)
        FROM public.promotion_campaign_vendor_products vp
       WHERE vp.registration_id = v_reg.id AND vp.active
    ), '[]'::JSONB)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_event_pickup_availability(UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_pickup_availability(UUID, DATE) TO anon, authenticated, service_role;

-- ── Reserve-now checkout ───────────────────────────────────────────────────
-- Price, stock, slot and date are all decided here; the client only chooses.

CREATE OR REPLACE FUNCTION public.prepare_event_checkout(
  p_listing_id UUID,
  p_pickup_date DATE,
  p_slot_id UUID,
  p_quantity INTEGER,
  p_payment_method TEXT,
  p_idempotency_key TEXT,
  p_request_hash TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_session public.checkout_sessions%ROWTYPE;
  v_slot public.promotion_campaign_pickup_slots%ROWTYPE;
  v_listing public.promotion_campaign_vendor_products%ROWTYPE;
  v_reg public.promotion_campaign_vendors%ROWTYPE;
  v_location public.promotion_campaign_locations%ROWTYPE;
  v_name TEXT;
  v_image TEXT;
  v_today DATE := (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::DATE;
  v_now_time TIME := (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::TIME;
  v_total NUMERIC;
  v_is_free BOOLEAN;
  v_cart_id UUID;
  v_order_id UUID;
  v_payment_id UUID;
  v_order_item_id UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'checkout_auth_required'; END IF;

  SELECT * INTO v_session FROM public.checkout_sessions
   WHERE user_id = v_user AND idempotency_key = p_idempotency_key
   FOR UPDATE;
  IF FOUND THEN
    IF v_session.request_hash <> p_request_hash THEN RAISE EXCEPTION 'idempotency_key_reused'; END IF;
    RETURN jsonb_build_object('checkout_session_id', v_session.id, 'order_id', v_session.order_id, 'status', v_session.status, 'total', v_session.total_amount);
  END IF;

  IF p_payment_method NOT IN ('mock_card', 'stripe_card', 'ewallet', 'bank_transfer', 'wallet', 'free_reservation') THEN
    RAISE EXCEPTION 'invalid_payment_method';
  END IF;
  IF p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'invalid_line_quantity'; END IF;

  -- Lock order: slot, then listing — the same in every call, so no deadlocks.
  SELECT * INTO v_slot FROM public.promotion_campaign_pickup_slots WHERE id = p_slot_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'event_slot_invalid'; END IF;
  SELECT * INTO v_listing FROM public.promotion_campaign_vendor_products WHERE id = p_listing_id FOR UPDATE;
  IF NOT FOUND OR NOT v_listing.active OR v_listing.registration_id <> v_slot.registration_id THEN
    RAISE EXCEPTION 'event_item_unavailable';
  END IF;

  SELECT reg.* INTO v_reg
    FROM public.promotion_campaign_vendors reg
    JOIN public.promotion_campaigns c ON c.id = reg.campaign_id
    JOIN public.vendors v ON v.id = reg.vendor_id
   WHERE reg.id = v_listing.registration_id
     AND reg.status = 'approved' AND c.status = 'approved' AND c.ends_at > now() AND v.status = 'approved';
  IF NOT FOUND THEN RAISE EXCEPTION 'event_item_unavailable'; END IF;

  SELECT * INTO v_location FROM public.promotion_campaign_locations WHERE id = v_reg.event_location_id;
  IF p_pickup_date IS NULL OR p_pickup_date < GREATEST(v_location.starts_on, v_today) OR p_pickup_date > v_location.ends_on THEN
    RAISE EXCEPTION 'event_date_invalid';
  END IF;
  IF (v_slot.slot_date IS NOT NULL AND v_slot.slot_date <> p_pickup_date)
     OR (p_pickup_date = v_today AND v_slot.ends_at <= v_now_time) THEN
    RAISE EXCEPTION 'event_slot_invalid';
  END IF;

  IF public.event_units_taken(v_listing.id, NULL, p_pickup_date) + p_quantity > v_listing.daily_quantity THEN
    RAISE EXCEPTION 'event_sold_out';
  END IF;
  IF public.event_units_taken(NULL, v_slot.id, p_pickup_date) + p_quantity > v_slot.capacity THEN
    RAISE EXCEPTION 'event_slot_full';
  END IF;

  v_total := ROUND(v_listing.price * p_quantity, 2);
  v_is_free := v_total = 0;
  IF v_is_free <> (p_payment_method = 'free_reservation') THEN RAISE EXCEPTION 'invalid_payment_method'; END IF;

  SELECT COALESCE(p.name, v_listing.name), COALESCE(p.cover_url, v_listing.image_url)
    INTO v_name, v_image
    FROM (SELECT 1) AS one
    LEFT JOIN public.products p ON p.id = v_listing.product_id;

  INSERT INTO public.carts (user_id) VALUES (v_user) ON CONFLICT (user_id) DO NOTHING;
  SELECT id INTO v_cart_id FROM public.carts WHERE user_id = v_user;

  INSERT INTO public.orders (user_id, status, subtotal, discount_amount, total_amount, payment_method, paid_at)
  VALUES (v_user, CASE WHEN v_is_free THEN 'paid' ELSE 'pending_payment' END, v_total, 0, v_total, p_payment_method,
          CASE WHEN v_is_free THEN now() ELSE NULL END)
  RETURNING id INTO v_order_id;

  INSERT INTO public.payments (order_id, method, provider, amount, status, idempotency_key, processed_at)
  VALUES (v_order_id, p_payment_method, CASE WHEN p_payment_method = 'stripe_card' THEN 'stripe' ELSE 'platform' END,
          v_total, CASE WHEN v_is_free THEN 'succeeded' ELSE 'pending' END, p_idempotency_key,
          CASE WHEN v_is_free THEN now() ELSE NULL END)
  RETURNING id INTO v_payment_id;

  INSERT INTO public.checkout_sessions (user_id, cart_id, order_id, payment_method, idempotency_key, request_hash, subtotal, discount_amount, total_amount, status)
  VALUES (v_user, v_cart_id, v_order_id, p_payment_method, p_idempotency_key, p_request_hash, v_total, 0, v_total,
          CASE WHEN v_is_free THEN 'paid' ELSE 'pending_payment' END)
  RETURNING * INTO v_session;

  -- variant_name snapshots "location · pickup window" so every existing order
  -- view shows where and when to collect without reading event tables.
  INSERT INTO public.order_items (
    order_id, vendor_id, outlet_id, product_id, product_name, image_url, variant_name, slot_starts_at,
    unit_price, quantity, line_total, fulfil_status,
    event_listing_id, event_location_id, pickup_date, pickup_slot_id
  ) VALUES (
    v_order_id, v_reg.vendor_id, NULL, NULL, v_name, v_image,
    v_location.name || ' · ' || to_char(v_slot.starts_at, 'HH24:MI') || '–' || to_char(v_slot.ends_at, 'HH24:MI'),
    (p_pickup_date + v_slot.starts_at) AT TIME ZONE 'Asia/Kuala_Lumpur',
    v_listing.price, p_quantity, v_total, 'pending',
    v_listing.id, v_location.id, p_pickup_date, v_slot.id
  ) RETURNING id INTO v_order_item_id;

  INSERT INTO public.checkout_reservations (checkout_session_id, kind, quantity, status, event_listing_id, pickup_date, pickup_slot_id)
  VALUES (v_session.id, 'event', p_quantity, CASE WHEN v_is_free THEN 'committed' ELSE 'held' END, v_listing.id, p_pickup_date, v_slot.id);

  RETURN jsonb_build_object(
    'checkout_session_id', v_session.id,
    'order_id', v_order_id,
    'payment_id', v_payment_id,
    'status', v_session.status,
    'expires_at', v_session.expires_at,
    'total', v_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_event_checkout(UUID, DATE, UUID, INTEGER, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prepare_event_checkout(UUID, DATE, UUID, INTEGER, TEXT, TEXT, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
