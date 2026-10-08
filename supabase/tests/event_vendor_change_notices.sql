-- Vendor change notice assertions. Executed in one rolled-back transaction.

SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
SET LOCAL request.jwt.claim.role = 'authenticated';
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';

-- Remove commitments so this test exercises the successful notice path.
DELETE FROM public.order_items
 WHERE order_id IN (
   'aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1'::uuid,
   'aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaa2'::uuid
 );
UPDATE public.checkout_reservations
   SET status = 'released'
 WHERE id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid;

DO $$
DECLARE
  v_location public.promotion_campaign_locations%ROWTYPE;
  v_result jsonb;
  v_count integer;
  v_owner_count integer;
  v_metadata text;
  v_payload text;
BEGIN
  SELECT * INTO v_location FROM public.promotion_campaign_locations
   WHERE id = '55555555-5555-4555-8555-555555555555'::uuid;
  v_result := public.save_promotion_campaign_location_protected(
    '44444444-4444-4444-8444-444444444444'::uuid,
    v_location.id,
    jsonb_build_object(
      'name', 'Main Pavilion',
      'address', '9 Jalan Baru, /tmp/internal-secret',
      'lat', 3.17,
      'lng', 101.67,
      'startsOn', v_location.starts_on,
      'endsOn', v_location.ends_on,
      'opensAt', '09:00',
      'closesAt', '18:00'
    ),
    v_location.updated_at,
    'Move vendors to the new hall'
  );
  IF coalesce((v_result->>'notificationQueued')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'location_notice_not_queued';
  END IF;
  SELECT count(*) INTO v_count FROM public.notifications WHERE category = 'vendor_account';
  IF v_count <> 2 THEN RAISE EXCEPTION 'location_notice_count: %', v_count; END IF;
  SELECT count(DISTINCT user_id) INTO v_owner_count
    FROM public.notifications WHERE category = 'vendor_account';
  IF v_owner_count <> 2 THEN RAISE EXCEPTION 'location_notice_owner_count: %', v_owner_count; END IF;
  IF EXISTS (SELECT 1 FROM public.notifications WHERE user_id = '00000000-0000-0000-0000-000000000001'::uuid) THEN
    RAISE EXCEPTION 'admin_received_vendor_notice';
  END IF;
  SELECT metadata::text INTO v_metadata
    FROM public.notifications WHERE category = 'vendor_account' ORDER BY created_at LIMIT 1;
  SELECT payload::text INTO v_payload
    FROM public.email_outbox WHERE event_type = 'vendor_event_update' ORDER BY created_at LIMIT 1;
  IF v_metadata ~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
     OR v_payload ~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
     OR v_metadata ~* '/tmp/|/storage/' THEN
    RAISE EXCEPTION 'internal_value_exposed_in_notice';
  END IF;
  IF v_metadata NOT LIKE '%/vendor/events%' THEN
    RAISE EXCEPTION 'vendor_action_path_missing';
  END IF;
END;
$$;

DO $$
DECLARE
  v_location public.promotion_campaign_locations%ROWTYPE;
  v_before_notifications integer;
  v_before_outbox integer;
  v_result jsonb;
BEGIN
  SELECT * INTO v_location FROM public.promotion_campaign_locations
   WHERE id = '55555555-5555-4555-8555-555555555555'::uuid;
  SELECT count(*) INTO v_before_notifications FROM public.notifications;
  SELECT count(*) INTO v_before_outbox FROM public.email_outbox;
  v_result := public.save_promotion_campaign_location_protected(
    '44444444-4444-4444-8444-444444444444'::uuid,
    v_location.id,
    jsonb_build_object(
      'name', v_location.name, 'address', v_location.address,
      'lat', v_location.lat, 'lng', v_location.lng,
      'startsOn', v_location.starts_on, 'endsOn', v_location.ends_on,
      'opensAt', v_location.opens_at, 'closesAt', v_location.closes_at
    ),
    v_location.updated_at,
    'No arrangement change'
  );
  IF coalesce((v_result->>'notificationQueued')::boolean, true) IS NOT FALSE THEN
    RAISE EXCEPTION 'location_noop_reported_change';
  END IF;
  IF (SELECT count(*) FROM public.notifications) <> v_before_notifications
     OR (SELECT count(*) FROM public.email_outbox) <> v_before_outbox THEN
    RAISE EXCEPTION 'location_noop_queued_notice';
  END IF;
END;
$$;

DO $$
DECLARE
  v_updated_at timestamptz;
  v_result jsonb;
  v_before_notifications integer;
  v_before_outbox integer;
BEGIN
  SELECT updated_at INTO v_updated_at FROM public.promotion_campaign_vendors
   WHERE id = '66666666-6666-4666-8666-666666666666'::uuid;
  SELECT count(*) INTO v_before_notifications FROM public.notifications;
  SELECT count(*) INTO v_before_outbox FROM public.email_outbox;
  v_result := public.change_campaign_vendor_stall(
    '66666666-6666-4666-8666-666666666666'::uuid,
    v_updated_at, 'B-7', 'Admin reassigned the stall'
  );
  IF coalesce((v_result->>'notificationQueued')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'stall_notice_not_queued';
  END IF;
  IF (SELECT count(*) FROM public.notifications) <> v_before_notifications + 1
     OR (SELECT count(*) FROM public.email_outbox) <> v_before_outbox + 1 THEN
    RAISE EXCEPTION 'stall_notice_count_wrong';
  END IF;
  SELECT updated_at INTO v_updated_at FROM public.promotion_campaign_vendors
   WHERE id = '66666666-6666-4666-8666-666666666666'::uuid;
  v_result := public.change_campaign_vendor_stall(
    '66666666-6666-4666-8666-666666666666'::uuid,
    v_updated_at, 'B-7', 'No stall change'
  );
  IF coalesce((v_result->>'notificationQueued')::boolean, true) IS NOT FALSE THEN
    RAISE EXCEPTION 'stall_noop_reported_change';
  END IF;
  IF (SELECT count(*) FROM public.notifications) <> v_before_notifications + 1
     OR (SELECT count(*) FROM public.email_outbox) <> v_before_outbox + 1 THEN
    RAISE EXCEPTION 'stall_noop_queued_notice';
  END IF;
END;
$$;

DO $$
DECLARE
  v_error text;
  v_name text;
  v_notification_count integer;
  v_outbox_count integer;
  v_audit_count integer;
BEGIN
  CREATE OR REPLACE FUNCTION public.event_test_fail_email_outbox()
  RETURNS trigger LANGUAGE plpgsql AS $function$
  BEGIN
    RAISE EXCEPTION 'event_test_notice_failure';
  END;
  $function$;
  CREATE TRIGGER event_test_fail_email_outbox
    BEFORE INSERT ON public.email_outbox
    FOR EACH ROW EXECUTE FUNCTION public.event_test_fail_email_outbox();

  BEGIN
    PERFORM public.save_promotion_campaign_location_protected(
      '44444444-4444-4444-8444-444444444444'::uuid,
      '55555555-5555-4555-8555-555555555555'::uuid,
      jsonb_build_object(
        'name', 'Atomic rollback hall',
        'address', 'Rollback address', 'lat', 3.17, 'lng', 101.67,
        'startsOn', date '2026-10-10', 'endsOn', date '2026-10-12',
        'opensAt', '09:00', 'closesAt', '18:00'
      ),
      (SELECT updated_at FROM public.promotion_campaign_locations
        WHERE id = '55555555-5555-4555-8555-555555555555'::uuid),
      'Rollback this notice transaction'
    );
  EXCEPTION WHEN OTHERS THEN
    v_error := SQLERRM;
  END;
  IF v_error IS DISTINCT FROM 'event_test_notice_failure' THEN
    RAISE EXCEPTION 'notice_failure_error: %', coalesce(v_error, '<none>');
  END IF;
  SELECT name INTO v_name FROM public.promotion_campaign_locations
   WHERE id = '55555555-5555-4555-8555-555555555555'::uuid;
  IF v_name <> 'Main Pavilion' THEN RAISE EXCEPTION 'location_change_not_rolled_back'; END IF;
  SELECT count(*) INTO v_notification_count FROM public.notifications;
  SELECT count(*) INTO v_outbox_count FROM public.email_outbox;
  SELECT count(*) INTO v_audit_count FROM public.audit_logs
   WHERE action = 'promotion_campaign_location.arrangements_changed';
  IF v_notification_count <> 3 OR v_outbox_count <> 3 OR v_audit_count <> 1 THEN
    RAISE EXCEPTION 'notice_atomicity_counts: %, %, %', v_notification_count, v_outbox_count, v_audit_count;
  END IF;
  DROP TRIGGER event_test_fail_email_outbox ON public.email_outbox;
  DROP FUNCTION public.event_test_fail_email_outbox();
END;
$$;

DO $$
BEGIN
  IF has_function_privilege('anon', 'app_private.queue_event_vendor_change_notice(uuid,uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'private_notice_helper_executable_by_anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.change_campaign_vendor_stall(uuid,timestamp with time zone,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'stall_wrapper_not_granted';
  END IF;
END;
$$;
