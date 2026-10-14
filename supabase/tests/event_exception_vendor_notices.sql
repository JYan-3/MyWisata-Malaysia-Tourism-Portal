-- Disposable loopback only. Each statement represents a committed business
-- transition except the explicitly deferred final-state test below.
SET CONSTRAINTS ALL IMMEDIATE;
DO $$ DECLARE oid uuid:='aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1'; outlet uuid; other_outlet uuid; c uuid; rid uuid; before_count integer; BEGIN
 INSERT INTO public.users(id,email,full_name,status) VALUES
 ('00000000-0000-0000-0000-000000000020','manager-a@example.test','Manager A','active'),
 ('00000000-0000-0000-0000-000000000021','manager-b@example.test','Manager B','active');
 INSERT INTO public.outlets(vendor_id,name,slug) VALUES('11111111-1111-4111-8111-111111111111','Outlet A','notice-outlet-a') RETURNING id INTO outlet;
 INSERT INTO public.outlets(vendor_id,name,slug) VALUES('11111111-1111-4111-8111-111111111112','Outlet B','notice-outlet-b') RETURNING id INTO other_outlet;
 INSERT INTO public.outlet_managers(outlet_id,user_id) VALUES(outlet,'00000000-0000-0000-0000-000000000020'),(other_outlet,'00000000-0000-0000-0000-000000000021');
 UPDATE public.orders SET display_id='ORD-NOTICE-1' WHERE id=oid;
 UPDATE public.order_items SET outlet_id=outlet,product_name='Only vendor A product',pickup_date=(now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date-1 WHERE order_id=oid;
 INSERT INTO public.order_items(order_id,vendor_id,product_name,unit_price,quantity,line_total,fulfil_status,event_location_id,pickup_date)
 VALUES(oid,'11111111-1111-4111-8111-111111111112','Only vendor B product',1,1,1,'pending','55555555-5555-4555-8555-555555555555',(now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date-1);
 INSERT INTO public.event_order_exceptions(source_key,kind,order_id,reason_code) VALUES('notice-test-pickup','pickup_overdue',oid,'pickup_outcome_unconfirmed') RETURNING id INTO c;
 IF (SELECT count(*) FROM public.notifications WHERE event_key LIKE 'vendor_exception:'||c||':%')<>3 THEN RAISE EXCEPTION 'pickup notices missing scoped owners/manager'; END IF;
 IF (SELECT count(*) FROM public.email_outbox WHERE event_key LIKE 'vendor_exception:'||c||':%')<>3 THEN RAISE EXCEPTION 'pickup email not durably queued'; END IF;
 IF EXISTS(SELECT 1 FROM public.notifications WHERE event_key LIKE 'vendor_exception:'||c||':%' AND user_id='00000000-0000-0000-0000-000000000021') THEN RAISE EXCEPTION 'unrelated outlet manager notified'; END IF;
 IF EXISTS(SELECT 1 FROM public.notifications WHERE event_key LIKE 'vendor_exception:'||c||':%' AND ((vendor_id='11111111-1111-4111-8111-111111111111' AND body LIKE '%Only vendor B%') OR (vendor_id='11111111-1111-4111-8111-111111111112' AND body LIKE '%Only vendor A%'))) THEN RAISE EXCEPTION 'cross-vendor items leaked'; END IF;
 IF EXISTS(SELECT 1 FROM public.notifications WHERE event_key LIKE 'vendor_exception:'||c||':%' AND (body||metadata::text||link) ~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}') THEN RAISE EXCEPTION 'display contains UUID'; END IF;
 UPDATE public.event_order_exceptions SET assigned_to='00000000-0000-0000-0000-000000000001',due_at=now()+interval '1 day',version=version+1,resolution_note='PRIVATE ADMIN NOTE pi_SECRET' WHERE id=c;
 IF (SELECT count(*) FROM public.notifications WHERE event_key LIKE 'vendor_exception:'||c||':%')<>3 THEN RAISE EXCEPTION 'assignment/deadline resent notice'; END IF;
 INSERT INTO public.refunds(order_id,payment_id,amount,reason,status) SELECT oid,id,0,'PRIVATE PROVIDER REASON','pending' FROM public.payments WHERE order_id=oid LIMIT 1 RETURNING id INTO rid;
 IF (SELECT count(*) FROM public.notifications WHERE event_key LIKE 'vendor_exception:'||c||':refund_pending:%')<>2 THEN RAISE EXCEPTION 'pending refund owners missing'; END IF;
 IF EXISTS(SELECT 1 FROM public.notifications WHERE event_key LIKE 'vendor_exception:'||c||':refund_pending:%' AND audience_role='outlet_manager') THEN RAISE EXCEPTION 'manager received financial phase'; END IF;
 UPDATE public.refunds SET provider_failure_message='PRIVATE PROVIDER FAILURE /storage/private' WHERE id=rid;
 IF (SELECT count(*) FROM public.notifications WHERE event_key LIKE 'vendor_exception:'||c||':refund_attention:%')<>2 THEN RAISE EXCEPTION 'message-only provider failure not notified'; END IF;
 SELECT count(*) INTO before_count FROM public.notifications WHERE event_key LIKE 'vendor_exception:'||c||':%';
 UPDATE public.refunds SET provider_failure_message='Changed private failure' WHERE id=rid;
 IF (SELECT count(*) FROM public.notifications WHERE event_key LIKE 'vendor_exception:'||c||':%')<>before_count THEN RAISE EXCEPTION 'same failure phase duplicated'; END IF;
 UPDATE public.refunds SET status='processed' WHERE id=rid;
 IF (SELECT count(*) FROM public.notifications WHERE event_key LIKE 'vendor_exception:'||c||':refunded:%')<>2 THEN RAISE EXCEPTION 'completed refund owners missing'; END IF;
 IF EXISTS(SELECT 1 FROM public.email_outbox WHERE event_key LIKE 'vendor_exception:'||c||':%' AND payload::text LIKE '%PRIVATE%') THEN RAISE EXCEPTION 'private notes/errors leaked'; END IF;
END $$;

-- An open and resolved case in one transaction must publish only final state.
SET CONSTRAINTS ALL DEFERRED;
INSERT INTO public.event_order_exceptions(source_key,kind,order_id,reason_code)
 VALUES('notice-test-transient','pickup_overdue','aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaa2','pickup_outcome_unconfirmed');
UPDATE public.event_order_exceptions SET state='resolved',resolution_code='customer_no_show',resolved_at=now() WHERE source_key='notice-test-transient';
SET CONSTRAINTS ALL IMMEDIATE;
DO $$ DECLARE c uuid; BEGIN
 SELECT id INTO c FROM public.event_order_exceptions WHERE source_key='notice-test-transient';
 IF EXISTS(SELECT 1 FROM public.notifications WHERE event_key LIKE 'vendor_exception:'||c||':pickup_review:%') THEN RAISE EXCEPTION 'transient open case notified'; END IF;
 IF (SELECT count(*) FROM public.notifications WHERE event_key LIKE 'vendor_exception:'||c||':no_show:%')<>1 THEN RAISE EXCEPTION 'null-outlet owner final notice missing'; END IF;
END $$;

DO $$ DECLARE c uuid; BEGIN
 UPDATE public.users SET email='' WHERE id='00000000-0000-0000-0000-000000000003';
 INSERT INTO public.event_order_exceptions(source_key,kind,order_id,reason_code) VALUES('notice-test-missing-email','payment_unfulfillable','aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1','payment_unfulfillable') RETURNING id INTO c;
 IF NOT EXISTS(SELECT 1 FROM public.notifications WHERE event_key LIKE 'vendor_exception:'||c||':%' AND user_id='00000000-0000-0000-0000-000000000003') THEN RAISE EXCEPTION 'blank email removed App notice'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.email_outbox WHERE event_key LIKE 'vendor_exception:'||c||':%' AND user_id='00000000-0000-0000-0000-000000000003' AND status='failed' AND last_error='recipient_email_unavailable') THEN RAISE EXCEPTION 'blank email failure not preserved'; END IF;
 IF has_function_privilege('anon','app_private.queue_event_exception_vendor_notice(uuid)','EXECUTE') OR has_function_privilege('authenticated','app_private.queue_event_exception_vendor_notice(uuid)','EXECUTE') OR has_function_privilege('service_role','app_private.queue_event_exception_vendor_notice(uuid)','EXECUTE') THEN RAISE EXCEPTION 'private notice helper callable'; END IF;
END $$;

-- Verified collection emits the final outcome rather than a transient reminder.
SET LOCAL request.jwt.claim.role='service_role';
SET CONSTRAINTS ALL DEFERRED;
UPDATE public.order_items SET fulfil_status='fulfilled',fulfilled_at=now()
 WHERE order_id='aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaa2' AND event_location_id IS NOT NULL;
INSERT INTO public.event_order_exceptions(source_key,kind,order_id,reason_code)
 VALUES('notice-test-collected','pickup_overdue','aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaa2','pickup_outcome_unconfirmed');
SELECT public.refresh_overdue_event_pickups();
SET CONSTRAINTS ALL IMMEDIATE;
DO $$ DECLARE c uuid; BEGIN
 SELECT id INTO c FROM public.event_order_exceptions WHERE source_key='notice-test-collected';
 IF NOT EXISTS(SELECT 1 FROM public.event_order_exceptions WHERE id=c AND state='resolved' AND resolution_code='collected') THEN
  RAISE EXCEPTION 'collection was not verified before notice'; END IF;
 IF (SELECT count(*) FROM public.notifications WHERE event_key LIKE 'vendor_exception:'||c||':collected:%')<>1
 OR (SELECT count(*) FROM public.email_outbox WHERE event_key LIKE 'vendor_exception:'||c||':collected:%')<>1 THEN
  RAISE EXCEPTION 'verified collection final notices missing'; END IF;
 IF EXISTS(SELECT 1 FROM public.notifications WHERE event_key LIKE 'vendor_exception:'||c||':pickup_review:%') THEN
  RAISE EXCEPTION 'verified collection emitted stale pickup reminder'; END IF;
END $$;
