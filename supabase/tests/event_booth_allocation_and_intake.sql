-- Rolled back by the disposable loopback test driver; no mail is sent.
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
SET LOCAL request.jwt.claim.role='authenticated';
SELECT set_config('mywisata.event_change_reason','Configure the event intake fixture',true);

CREATE FUNCTION pg_temp.expect_event_error(statement text, expected text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual text;
BEGIN
  BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN actual:=SQLERRM; END;
  IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'expected %, got %',expected,coalesce(actual,'success'); END IF;
END; $$;

DO $$
DECLARE r public.promotion_campaign_vendors%ROWTYPE; result jsonb; l public.promotion_campaign_locations%ROWTYPE;
  input jsonb; before_notices integer;
BEGIN
  SELECT * INTO r FROM public.promotion_campaign_vendors WHERE id='66666666-6666-4666-8666-666666666667';
  IF r.stall_number IS NOT NULL OR r.requested_stall_number<>'A-2' THEN RAISE EXCEPTION 'pending label was not migrated to preference'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.promotion_campaign_vendors WHERE id='66666666-6666-4666-8666-666666666666' AND stall_number='A-1') THEN RAISE EXCEPTION 'legacy approved assignment lost'; END IF;
  UPDATE public.promotion_campaign_locations SET applications_close_at=clock_timestamp()+interval '1 hour',
    approvals_close_at=clock_timestamp()+interval '2 hours',setup_starts_at=clock_timestamp()+interval '3 hours',applications_open=true
    WHERE id=r.event_location_id;
  PERFORM pg_temp.expect_event_error(format('SELECT public.review_campaign_vendor_registration_with_stall(%L,''approve'',NULL,%L,%L)',r.id,r.updated_at,'A-2'),'event_capacity_unconfirmed');
  SELECT * INTO l FROM public.promotion_campaign_locations WHERE id=r.event_location_id;
  input:=jsonb_build_object('name',l.name,'address',l.address,'lat',l.lat,'lng',l.lng,'startsOn',l.starts_on,
    'endsOn',l.ends_on,'opensAt',l.opens_at,'closesAt',l.closes_at,'maxStalls',2);
  result:=public.preview_promotion_campaign_location_change(l.campaign_id,l.id,input,l.updated_at);
  IF NOT (result->>'requiresReason')::boolean OR (result->>'affectedVendors')::integer<>0 THEN RAISE EXCEPTION 'capacity-only preview did not distinguish reason from notice recipients'; END IF;
  SELECT count(*) INTO before_notices FROM public.email_outbox;
  result:=public.save_promotion_campaign_location_protected(l.campaign_id,l.id,input,l.updated_at,'Confirm the physical layout capacity');
  IF (result->>'notificationQueued')::boolean OR (SELECT count(*) FROM public.email_outbox)<>before_notices THEN RAISE EXCEPTION 'capacity-only change spammed participants'; END IF;
  PERFORM set_config('mywisata.event_change_reason','Verify physical capacity limits',true);
  PERFORM pg_temp.expect_event_error(format('SELECT public.review_campaign_vendor_registration_with_stall(%L,''approve'',NULL,%L,%L)',r.id,r.updated_at,' a-1 '),'event_stall_conflict');
  PERFORM pg_temp.expect_event_error(format('SELECT public.review_campaign_vendor_registration(%L,''approve'',NULL)',r.id),'invalid_stall_number');
  result:=public.review_campaign_vendor_registration_with_stall(r.id,'approve',NULL,r.updated_at,'A-2');
  IF NOT (result->>'notificationQueued')::boolean THEN RAISE EXCEPTION 'approval notice was not queued'; END IF;
  IF (SELECT count(*) FROM public.email_outbox WHERE event_type='vendor_event_update')<1 THEN RAISE EXCEPTION 'approval mail absent'; END IF;
  PERFORM pg_temp.expect_event_error(format('UPDATE public.promotion_campaign_locations SET max_stalls=1 WHERE id=%L',r.event_location_id),'event_capacity_below_occupied');
  SELECT * INTO r FROM public.promotion_campaign_vendors WHERE id=r.id;
  result:=public.change_campaign_vendor_stall(r.id,r.updated_at,'A-12','Correct booth placement');
  IF NOT (result->>'notificationQueued')::boolean THEN RAISE EXCEPTION 'changed assignment not notified'; END IF;
  SELECT * INTO r FROM public.promotion_campaign_vendors WHERE id=r.id;
  result:=public.change_campaign_vendor_stall(r.id,r.updated_at,'A-12',NULL);
  IF (result->>'notificationQueued')::boolean THEN RAISE EXCEPTION 'no-op duplicated notification'; END IF;
  PERFORM set_config('mywisata.event_change_reason','Direct change still needs collision checks',true);
  PERFORM pg_temp.expect_event_error(format('UPDATE public.promotion_campaign_vendors SET stall_number=''a-1'' WHERE id=%L',r.id),'event_stall_conflict');
END; $$;

-- An approved-only location still requires an administrative close reason,
-- while a deadline-only change does not notify approved participants.
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
DO $$ DECLARE l public.promotion_campaign_locations%ROWTYPE; input jsonb; preview jsonb;
BEGIN
  UPDATE public.promotion_campaign_vendors SET status='rejected' WHERE status IN ('pending','changes_requested');
  SELECT * INTO l FROM public.promotion_campaign_locations WHERE id='55555555-5555-4555-8555-555555555555';
  input:=jsonb_build_object('name',l.name,'address',l.address,'lat',l.lat,'lng',l.lng,'startsOn',l.starts_on,
    'endsOn',l.ends_on,'opensAt',l.opens_at,'closesAt',l.closes_at,'applicationsOpen',false);
  UPDATE public.promotion_campaign_locations SET applications_open=true WHERE id=l.id;
  SELECT * INTO l FROM public.promotion_campaign_locations WHERE id=l.id;
  preview:=public.preview_promotion_campaign_location_change(l.campaign_id,l.id,input,l.updated_at);
  IF NOT (preview->>'requiresReason')::boolean OR (preview->>'affectedVendors')::integer<>0 THEN RAISE EXCEPTION 'approved-only intake close reason mismatch'; END IF;
END; $$;

-- Deadline crossing and corrections use the real RPC/trigger boundaries.
UPDATE public.promotion_campaign_vendors SET status='changes_requested' WHERE id='66666666-6666-4666-8666-666666666668';
UPDATE public.promotion_campaign_locations SET applications_close_at=clock_timestamp()-interval '1 minute'
  WHERE id='55555555-5555-4555-8555-555555555555';
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',true);
DO $$
DECLARE r public.promotion_campaign_vendors%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.promotion_campaign_vendors WHERE id='66666666-6666-4666-8666-666666666668';
  PERFORM public.resubmit_campaign_vendor_registration(r.id,'','Vendor three revised stall','https://example.test/poster.png',
    '[{"kind":"new","name":"Craft gift","imageUrl":null,"price":12,"dailyQuantity":5,"itemKind":"product"}]'::jsonb);
  IF NOT EXISTS(SELECT 1 FROM public.promotion_campaign_vendors WHERE id=r.id AND status='pending' AND requested_stall_number IS NULL AND stall_number IS NULL) THEN RAISE EXCEPTION 'blank preferred booth resubmit failed'; END IF;
END; $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
SELECT pg_temp.expect_event_error('UPDATE public.promotion_campaign_vendors SET status=''approved'',stall_number=''A-3'' WHERE id=''66666666-6666-4666-8666-666666666668''','event_capacity_full');
UPDATE public.promotion_campaign_locations SET approvals_close_at=clock_timestamp()-interval '1 second'
  WHERE id='55555555-5555-4555-8555-555555555555';
SELECT pg_temp.expect_event_error('UPDATE public.promotion_campaign_vendors SET status=''approved'',stall_number=''A-3'' WHERE id=''66666666-6666-4666-8666-666666666668''','event_approvals_closed');
SELECT pg_temp.expect_event_error('UPDATE public.promotion_campaign_vendors SET status=''changes_requested'' WHERE id=''66666666-6666-4666-8666-666666666668''','event_approvals_closed');
SELECT public.review_campaign_vendor_registration('66666666-6666-4666-8666-666666666668','reject','The approval window has closed');

-- Closing intake must not affect checkout for previously approved vendors.
UPDATE public.promotion_campaign_locations SET applications_open=false WHERE id='55555555-5555-4555-8555-555555555555';
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
SELECT public.prepare_event_checkout('77777777-7777-4777-8777-777777777777',date '2026-10-10',
  '88888888-8888-4888-8888-888888888888',1,'mock_card','closed-intake-checkout','fixture');

DO $$ BEGIN
  IF has_function_privilege('anon','public.review_campaign_vendor_registration_with_stall(uuid,text,text,timestamptz,text)','EXECUTE') THEN RAISE EXCEPTION 'anonymous approval exposed'; END IF;
  IF has_function_privilege('authenticated','app_private.guard_event_booth_registration()','EXECUTE') THEN RAISE EXCEPTION 'guard helper exposed'; END IF;
END; $$;

-- Unknown capacity permits new applications; labels are scoped per location.
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
DO $$
DECLARE l public.promotion_campaign_locations%ROWTYPE; second_location uuid; registration uuid; version timestamptz;
  products jsonb:='[{"kind":"new","name":"Craft gift","imageUrl":null,"price":12,"dailyQuantity":5,"itemKind":"product"}]';
BEGIN
  SELECT * INTO l FROM public.promotion_campaign_locations WHERE id='55555555-5555-4555-8555-555555555555';
  second_location:=(public.save_promotion_campaign_location_protected(l.campaign_id,NULL,
    jsonb_build_object('name','Second concourse','address',l.address,'lat',l.lat,'lng',l.lng,
      'startsOn',l.starts_on,'endsOn',l.ends_on,'opensAt',l.opens_at,'closesAt',l.closes_at,'maxStalls',NULL,
      'applicationsOpen',true,'applicationsCloseAt',clock_timestamp()+interval '1 hour',
      'approvalsCloseAt',clock_timestamp()+interval '2 hours','setupStartsAt',clock_timestamp()+interval '3 hours'),NULL,NULL)->>'id')::uuid;
  PERFORM set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',true);
  registration:=public.submit_campaign_vendor_registration(second_location,'11111111-1111-4111-8111-111111111113',
    'A-1','Vendor three other concourse','https://example.test/poster.png',products);
  IF NOT EXISTS(SELECT 1 FROM public.promotion_campaign_vendors WHERE id=registration AND stall_number IS NULL AND requested_stall_number='A-1') THEN RAISE EXCEPTION 'new request incorrectly assigned a booth'; END IF;
  PERFORM set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',true);
  PERFORM set_config('mywisata.event_change_reason','Confirm second area capacity',true);
  UPDATE public.promotion_campaign_locations SET max_stalls=1 WHERE id=second_location;
  SELECT updated_at INTO version FROM public.promotion_campaign_vendors WHERE id=registration;
  PERFORM public.review_campaign_vendor_registration_with_stall(registration,'approve',NULL,version,'A-1');
  UPDATE public.promotion_campaign_locations SET applications_open=false WHERE id=second_location;
  PERFORM set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
  PERFORM pg_temp.expect_event_error(format('SELECT public.submit_campaign_vendor_registration(%L,%L,'''',''Vendor two late application'',''https://example.test/poster.png'',%L::jsonb)',
    second_location,'11111111-1111-4111-8111-111111111112',products),'event_applications_closed');
END; $$;
