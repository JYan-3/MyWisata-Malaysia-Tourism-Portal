-- These sections are executed by scripts/test-event-management-db.mjs.
-- The runner wraps each section in its own transaction.

-- EVENT_TEST_PHASE: seed
INSERT INTO public.users (id, email, full_name, status, email_verified_at)
VALUES
  ('00000000-0000-0000-0000-000000000001'::uuid, 'event-admin@example.test', 'Event Admin', 'active', now()),
  ('00000000-0000-0000-0000-000000000002'::uuid, 'vendor-one@example.test', 'Vendor One Owner', 'active', now()),
  ('00000000-0000-0000-0000-000000000003'::uuid, 'vendor-two@example.test', 'Vendor Two Owner', 'active', now()),
  ('00000000-0000-0000-0000-000000000004'::uuid, 'event-customer@example.test', 'Event Customer', 'active', now()),
  ('00000000-0000-0000-0000-000000000005'::uuid, 'vendor-three@example.test', 'Vendor Three Owner', 'active', now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.vendors (id, owner_id, name, slug, status, kind)
VALUES
  ('11111111-1111-4111-8111-111111111111'::uuid, '00000000-0000-0000-0000-000000000002'::uuid, 'Vendor One', 'event-vendor-one', 'approved', 'food'),
  ('11111111-1111-4111-8111-111111111112'::uuid, '00000000-0000-0000-0000-000000000003'::uuid, 'Vendor Two', 'event-vendor-two', 'approved', 'retail'),
  ('11111111-1111-4111-8111-111111111113'::uuid, '00000000-0000-0000-0000-000000000005'::uuid, 'Vendor Three', 'event-vendor-three', 'approved', 'service')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.promotion_campaigns (
  id, slug, title, summary, description, starts_at, ends_at, status, created_by, updated_by
)
VALUES (
  '44444444-4444-4444-8444-444444444444'::uuid, 'event-fixture', 'Event Fixture',
  'A deterministic event fixture', 'A deterministic event fixture for local database verification',
  timestamptz '2026-10-10 09:00:00+08', timestamptz '2026-10-20 22:00:00+08',
  'approved', '00000000-0000-0000-0000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000001'::uuid
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.promotion_campaign_locations (
  id, campaign_id, name, address, lat, lng, starts_on, ends_on, opens_at, closes_at, status
)
VALUES (
  '55555555-5555-4555-8555-555555555555'::uuid,
  '44444444-4444-4444-8444-444444444444'::uuid,
  'Main Hall', '1 Jalan Event, Kuala Lumpur', 3.1700, 101.6700,
  date '2026-10-10', date '2026-10-12', time '09:00', time '18:00', 'active'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.promotion_campaign_vendors (
  id, campaign_id, vendor_id, submitted_by, event_location_id,
  stall_number, stall_description, stall_poster_url, status
)
VALUES
  ('66666666-6666-4666-8666-666666666666'::uuid,
   '44444444-4444-4444-8444-444444444444'::uuid,
   '11111111-1111-4111-8111-111111111111'::uuid,
   '00000000-0000-0000-0000-000000000002'::uuid,
   '55555555-5555-4555-8555-555555555555'::uuid,
   'A-1', 'Vendor one event stall', 'https://example.test/stall-one.png', 'approved'),
  ('66666666-6666-4666-8666-666666666667'::uuid,
   '44444444-4444-4444-8444-444444444444'::uuid,
   '11111111-1111-4111-8111-111111111112'::uuid,
   '00000000-0000-0000-0000-000000000003'::uuid,
   '55555555-5555-4555-8555-555555555555'::uuid,
   'A-2', 'Vendor two event stall', 'https://example.test/stall-two.png', 'pending'),
  ('66666666-6666-4666-8666-666666666668'::uuid,
   '44444444-4444-4444-8444-444444444444'::uuid,
   '11111111-1111-4111-8111-111111111113'::uuid,
   '00000000-0000-0000-0000-000000000005'::uuid,
   '55555555-5555-4555-8555-555555555555'::uuid,
   'A-3', 'Vendor three event stall', 'https://example.test/stall-three.png', 'rejected')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.promotion_campaign_vendor_products (
  id, registration_id, name, price, image_url, item_kind, daily_quantity, active, position
)
VALUES (
  '77777777-7777-4777-8777-777777777777'::uuid,
  '66666666-6666-4666-8666-666666666666'::uuid,
  'Fixture drink', 12.00, 'https://example.test/drink.png', 'product', 10, true, 0
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.promotion_campaign_pickup_slots (
  id, registration_id, slot_date, starts_at, ends_at, capacity
)
VALUES (
  '88888888-8888-4888-8888-888888888888'::uuid,
  '66666666-6666-4666-8666-666666666666'::uuid,
  NULL, time '10:00', time '12:00', 10
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.orders (
  id, user_id, status, subtotal, discount_amount, total_amount, payment_method, paid_at
)
VALUES
  ('aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid,
   '00000000-0000-0000-0000-000000000004'::uuid, 'paid', 12, 0, 12, 'mock_card', now()),
  ('aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaa2'::uuid,
   '00000000-0000-0000-0000-000000000004'::uuid, 'paid', 0, 0, 0, 'free_reservation', now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.order_items (
  id, order_id, vendor_id, outlet_id, product_name, variant_name, unit_price,
  quantity, line_total, fulfil_status, event_listing_id, event_location_id,
  pickup_date, pickup_slot_id
)
VALUES
  ('bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbb1'::uuid,
   'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid,
   '11111111-1111-4111-8111-111111111111'::uuid, NULL, 'Fixture drink', 'Main Hall · 10:00–12:00',
   12, 1, 12, 'pending', '77777777-7777-4777-8777-777777777777'::uuid,
   '55555555-5555-4555-8555-555555555555'::uuid, date '2026-10-10', '88888888-8888-4888-8888-888888888888'::uuid),
  ('bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbb2'::uuid,
   'aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaa2'::uuid,
   '11111111-1111-4111-8111-111111111111'::uuid, NULL, 'Fixture drink', 'Main Hall · 10:00–12:00',
   0, 1, 0, 'pending', '77777777-7777-4777-8777-777777777777'::uuid,
   '55555555-5555-4555-8555-555555555555'::uuid, date '2026-10-10', '88888888-8888-4888-8888-888888888888'::uuid)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.checkout_sessions (
  id, user_id, order_id, payment_method, idempotency_key, request_hash,
  subtotal, discount_amount, total_amount, status, expires_at
)
VALUES (
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid,
  '00000000-0000-0000-0000-000000000004'::uuid,
  'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid,
  'mock_card', 'fixture-held', 'fixture-held-hash', 12, 0, 12,
  'pending_payment', now() + interval '1 day'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.checkout_reservations (
  id, checkout_session_id, kind, quantity, status, event_listing_id, pickup_date, pickup_slot_id
)
VALUES (
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid,
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid,
  'event', 1, 'held', '77777777-7777-4777-8777-777777777777'::uuid,
  date '2026-10-10', '88888888-8888-4888-8888-888888888888'::uuid
)
ON CONFLICT (id) DO NOTHING;

-- EVENT_TEST_PHASE: baseline
DO $$
DECLARE
  v_closes_at time;
BEGIN
  -- Before 20261007034900, the existing location RPC/trigger chain accepts
  -- an operating-hours shrink even when a paid/free reservation and a live
  -- checkout hold use that window. This is the expected baseline failure.
  UPDATE public.promotion_campaign_locations
     SET closes_at = time '11:00'
   WHERE id = '55555555-5555-4555-8555-555555555555'::uuid;
  SELECT closes_at INTO v_closes_at
    FROM public.promotion_campaign_locations
   WHERE id = '55555555-5555-4555-8555-555555555555'::uuid;
  IF v_closes_at <> time '11:00' THEN
    RAISE EXCEPTION 'baseline_hours_shrink_not_reproduced';
  END IF;
END;
$$;

-- EVENT_TEST_PHASE: patched
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
SET LOCAL request.jwt.claim.role = 'authenticated';
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';

DO $$
DECLARE
  v_error text;
  v_closes_at time;
BEGIN
  BEGIN
    UPDATE public.promotion_campaign_locations
       SET closes_at = time '11:00'
     WHERE id = '55555555-5555-4555-8555-555555555555'::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'location_change_has_reservations' THEN
    RAISE EXCEPTION 'hours_guard_error: %', coalesce(v_error, '<none>');
  END IF;
  SELECT closes_at INTO v_closes_at
    FROM public.promotion_campaign_locations
   WHERE id = '55555555-5555-4555-8555-555555555555'::uuid;
  IF v_closes_at <> time '18:00' THEN
    RAISE EXCEPTION 'hours_guard_changed_row_after_rejection';
  END IF;
END;
$$;

DO $$
DECLARE
  v_error text;
BEGIN
  BEGIN
    UPDATE public.promotion_campaign_locations
       SET address = 'Changed address'
     WHERE id = '55555555-5555-4555-8555-555555555555'::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'location_change_has_reservations' THEN
    RAISE EXCEPTION 'address_guard_error: %', coalesce(v_error, '<none>');
  END IF;
END;
$$;

-- The pre-existing cancellation trigger remains authoritative; the new
-- checkout prelude must reject a cancelled location before creating a hold.
DO $$
DECLARE
  v_error text;
BEGIN
  UPDATE public.promotion_campaign_locations
     SET status = 'cancelled'
   WHERE id = '55555555-5555-4555-8555-555555555555'::uuid;
  BEGIN
    PERFORM public.prepare_event_checkout(
      '77777777-7777-4777-8777-777777777777'::uuid,
      date '2026-10-10',
      '88888888-8888-4888-8888-888888888888'::uuid,
      1, 'mock_card', 'cancelled-location-guard-2', 'guard-hash'
    );
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'promotion_campaign_location_cancelled' THEN
    RAISE EXCEPTION 'cancelled_location_guard_error: %', coalesce(v_error, '<none>');
  END IF;
  UPDATE public.promotion_campaign_locations
     SET status = 'active'
   WHERE id = '55555555-5555-4555-8555-555555555555'::uuid;
  UPDATE public.promotion_campaign_vendors
     SET status = CASE id
       WHEN '66666666-6666-4666-8666-666666666666'::uuid THEN 'approved'
       WHEN '66666666-6666-4666-8666-666666666667'::uuid THEN 'pending'
       ELSE status
     END
   WHERE id IN (
     '66666666-6666-4666-8666-666666666666'::uuid,
     '66666666-6666-4666-8666-666666666667'::uuid
   );
END;
$$;

DO $$
DECLARE
  v_error text;
BEGIN
  BEGIN
    UPDATE public.promotion_campaigns
       SET starts_at = timestamptz '2026-10-11 09:00:00+08',
           ends_at = timestamptz '2026-10-11 23:00:00+08'
     WHERE id = '44444444-4444-4444-8444-444444444444'::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'locations_outside_event' THEN
    RAISE EXCEPTION 'campaign_containment_error: %', coalesce(v_error, '<none>');
  END IF;
END;
$$;

DO $$
DECLARE
  v_campaign_id uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid;
  v_error text;
BEGIN
  INSERT INTO public.promotion_campaigns (
    id, slug, title, summary, description, starts_at, ends_at,
    status, created_by, updated_by
  ) VALUES (
    v_campaign_id, 'event-without-location', 'Event without location',
    'A campaign used only for guard tests', 'A campaign used only for guard tests',
    timestamptz '2026-10-10 09:00:00+08', timestamptz '2026-10-20 22:00:00+08',
    'draft', '00000000-0000-0000-0000-000000000001'::uuid,
    '00000000-0000-0000-0000-000000000001'::uuid
  );
  BEGIN
    UPDATE public.promotion_campaigns SET status = 'approved' WHERE id = v_campaign_id;
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'no_active_location' THEN
    RAISE EXCEPTION 'campaign_location_requirement_error: %', coalesce(v_error, '<none>');
  END IF;
END;
$$;

DO $$
DECLARE
  v_public jsonb;
BEGIN
  UPDATE public.promotion_campaign_locations
     SET status = 'cancelled'
   WHERE id = '55555555-5555-4555-8555-555555555555'::uuid;
  SELECT public.get_public_promotion_campaigns('event-fixture') INTO v_public;
  IF v_public <> '[]'::jsonb THEN
    RAISE EXCEPTION 'cancelled_location_visible_publicly: %', v_public;
  END IF;
  UPDATE public.promotion_campaign_locations
     SET status = 'active'
   WHERE id = '55555555-5555-4555-8555-555555555555'::uuid;
  UPDATE public.promotion_campaign_vendors
     SET status = CASE id
       WHEN '66666666-6666-4666-8666-666666666666'::uuid THEN 'approved'
       WHEN '66666666-6666-4666-8666-666666666667'::uuid THEN 'pending'
       ELSE status
     END
   WHERE id IN (
     '66666666-6666-4666-8666-666666666666'::uuid,
     '66666666-6666-4666-8666-666666666667'::uuid
   );
END;
$$;

DO $$
DECLARE
  v_error text;
  v_impact jsonb;
  v_result jsonb;
  v_location public.promotion_campaign_locations%ROWTYPE;
BEGIN
  -- Released holds and fulfilled/deleted order lines do not block a change;
  -- an active pickup slot outside the proposed hours still does.
  DELETE FROM public.order_items
   WHERE order_id IN (
     'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid,
     'aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaa2'::uuid
   );
  UPDATE public.checkout_reservations
     SET status = 'released'
   WHERE id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid;
  SELECT app_private.event_location_change_impact(
    '55555555-5555-4555-8555-555555555555'::uuid,
    'Jalan Test', 3.17, 101.67, date '2026-10-10', date '2026-10-12',
    time '09:00', time '11:00'
  ) INTO v_impact;
  IF (v_impact->>'affectedReservations')::integer <> 0
     OR (v_impact->>'incompatibleSlots')::integer <> 1 THEN
    RAISE EXCEPTION 'released_commitment_impact_wrong: %', v_impact;
  END IF;
  BEGIN
    UPDATE public.promotion_campaign_locations
       SET closes_at = time '11:00'
     WHERE id = '55555555-5555-4555-8555-555555555555'::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'location_change_has_slots' THEN
    RAISE EXCEPTION 'slot_guard_error: %', coalesce(v_error, '<none>');
  END IF;
  SELECT * INTO v_location FROM public.promotion_campaign_locations
   WHERE id = '55555555-5555-4555-8555-555555555555'::uuid;
  v_result := public.save_promotion_campaign_location_protected(
    '44444444-4444-4444-8444-444444444444'::uuid,
    v_location.id,
    jsonb_build_object(
      'name', v_location.name, 'address', v_location.address,
      'lat', v_location.lat, 'lng', v_location.lng,
      'startsOn', v_location.starts_on, 'endsOn', v_location.ends_on,
      'opensAt', '09:00', 'closesAt', '17:00'
    ),
    v_location.updated_at,
    'Released commitments permit this change'
  );
  IF coalesce((v_result->>'notificationQueued')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'released_commitment_change_not_saved';
  END IF;
END;
$$;

DO $$
BEGIN
  IF has_function_privilege('anon', 'app_private.lock_event_campaign(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'private_lock_helper_executable_by_anon';
  END IF;
  IF has_function_privilege('authenticated', 'app_private.event_location_change_impact(uuid,text,double precision,double precision,date,date,time without time zone,time without time zone)', 'EXECUTE') THEN
    RAISE EXCEPTION 'private_impact_helper_executable_by_authenticated';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.save_promotion_campaign_location_protected(uuid,uuid,jsonb,timestamp with time zone,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'protected_location_wrapper_not_granted';
  END IF;
END;
$$;
