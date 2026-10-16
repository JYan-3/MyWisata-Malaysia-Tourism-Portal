-- Disposable loopback only; actual installed cores/finalizers and new guards.
BEGIN;
SET LOCAL request.jwt.claim.role='authenticated';
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000004';
DO $$ DECLARE a jsonb; b jsonb; sid uuid; oid uuid; err text; BEGIN
 UPDATE public.checkout_reservations SET status='released';
 UPDATE public.checkout_sessions SET status='expired';
 UPDATE public.promotion_campaign_pickup_slots SET capacity=100;
 a:=public.prepare_event_checkout('77777777-7777-4777-8777-777777777777','2026-10-10','88888888-8888-4888-8888-888888888888',1,'stripe_card','budget-a','budget-same');
 sid:=(a->>'checkout_session_id')::uuid; oid:=(a->>'order_id')::uuid;
 b:=public.prepare_event_checkout('77777777-7777-4777-8777-777777777777','2026-10-10','88888888-8888-4888-8888-888888888888',1,'stripe_card','budget-b','budget-same');
 IF b->>'checkout_session_id'<>sid::text THEN RAISE EXCEPTION 'retry created second checkout'; END IF;
 BEGIN PERFORM public.prepare_event_checkout('77777777-7777-4777-8777-777777777777','2026-10-10','88888888-8888-4888-8888-888888888888',2,'stripe_card','budget-c','changed');
 EXCEPTION WHEN OTHERS THEN err:=SQLERRM; END;
 IF err IS DISTINCT FROM 'active_checkout_exists' THEN RAISE EXCEPTION 'changed request not blocked: %',err; END IF;
 -- Account loss after prepare: wallet finalization cannot debit or fulfil.
 UPDATE public.users SET status='suspended' WHERE id='00000000-0000-0000-0000-000000000004';
 err:=NULL;
 BEGIN PERFORM public.finalize_checkout(sid,'succeeded'); EXCEPTION WHEN OTHERS THEN err:=SQLERRM; END;
 IF err IS DISTINCT FROM 'checkout_commitment_unavailable' THEN RAISE EXCEPTION 'lost eligibility was fulfilled: %',err; END IF;
 UPDATE public.payments SET provider_payment_id='cs_eligibility_test' WHERE order_id=oid;
 PERFORM set_config('request.jwt.claim.role','service_role',true);
 PERFORM set_config('request.jwt.claim.sub','',true);
 PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true);
 a:=public.settle_provider_checkout(sid,'stripe','succeeded','cs_eligibility_test','evt_eligibility_test',repeat('a',64),1200,'MYR');
 IF a->>'status'<>'payment_exception' OR (SELECT status FROM public.orders WHERE id=oid)<>'cancelled' THEN RAISE EXCEPTION 'verified money was lost or fulfilment continued'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.event_order_exceptions e JOIN public.refunds r ON r.id=e.refund_id
  WHERE e.checkout_session_id=sid AND e.reason_code='checkout_eligibility_lost' AND r.auto_process=false AND e.verified_amount_sen=1200) THEN RAISE EXCEPTION 'manual receipt review missing'; END IF;
 a:=public.settle_provider_checkout(sid,'stripe','succeeded','cs_eligibility_test','evt_eligibility_test',repeat('a',64),1200,'MYR');
 IF a->>'status'<>'payment_exception' OR (SELECT count(*) FROM public.event_order_exceptions WHERE checkout_session_id=sid)<>1 THEN RAISE EXCEPTION 'receipt replay duplicated case'; END IF;
 err:=NULL;
 BEGIN PERFORM public.settle_provider_checkout(sid,'stripe','succeeded','cs_eligibility_test','evt_eligibility_test',repeat('b',64),1200,'MYR'); EXCEPTION WHEN OTHERS THEN err:=SQLERRM; END;
 IF err IS DISTINCT FROM 'provider_event_conflict' THEN RAISE EXCEPTION 'conflicting receipt accepted'; END IF;
END; $$;
ROLLBACK;

-- Ordinary inventory Checkout: real authoritative pricing/core, changed
-- quantities cannot reuse a hash, and retries must not reserve stock twice.
BEGIN;
SET LOCAL request.jwt.claim.role='service_role';
SET LOCAL request.jwt.claim.sub='';
SET LOCAL request.jwt.claims='{"role":"service_role"}';
ALTER TABLE public.cart_items ADD COLUMN IF NOT EXISTS outlet_id uuid;
ALTER TABLE public.products ALTER COLUMN outlet_id DROP NOT NULL;
ALTER TABLE public.inventory ADD COLUMN IF NOT EXISTS outlet_id uuid;
ALTER TABLE public.price_rules ADD COLUMN IF NOT EXISTS priority integer DEFAULT 0, ADD COLUMN IF NOT EXISTS bundle_product_ids uuid[];
DO $$ DECLARE g uuid; cart uuid; item uuid; product uuid:=gen_random_uuid(); variant uuid:=gen_random_uuid(); outlet uuid:=gen_random_uuid(); lines jsonb; a jsonb; b jsonb; sid uuid; err text; BEGIN
 INSERT INTO public.guest_checkout_subjects(expires_at) VALUES(now()+interval '1 day') RETURNING id INTO g;
 INSERT INTO public.carts(guest_subject_id) VALUES(g) RETURNING id INTO cart;
 INSERT INTO public.outlets(id,vendor_id,name,slug,status) VALUES(outlet,'11111111-1111-4111-8111-111111111111','Inventory test',outlet::text,'active');
 INSERT INTO public.products(id,vendor_id,name,slug,base_price,requires_booking,status,review_status,product_type)
 VALUES(product,'11111111-1111-4111-8111-111111111111','Inventory test',product::text,10,false,'active','approved','retail');
 INSERT INTO public.product_variants(id,product_id,name,price_offset,is_active) VALUES(variant,product,'Standard',2,true);
 INSERT INTO public.outlet_offers(product_id,outlet_id,price,status) VALUES(product,outlet,20,'active');
 INSERT INTO public.inventory(variant_id,outlet_id,quantity,reserved) VALUES(variant,outlet,10,0);
 INSERT INTO public.cart_items(cart_id,variant_id,outlet_id,quantity,unit_price) VALUES(cart,variant,outlet,1,22) RETURNING id INTO item;
 lines:=jsonb_build_array(jsonb_build_object('cart_item_id',item,'product_id',product,'variant_id',variant,'slot_id',NULL,'vendor_id','11111111-1111-4111-8111-111111111111','outlet_id',outlet,'product_name','Inventory test','image_url',NULL,'variant_name','Standard','slot_starts_at',NULL,'unit_price',22,'quantity',1,'line_total',22,'requires_booking',false));
 a:=public.checkout_transaction_core(cart,ARRAY[item],'ordinary-a','ordinary-hash','stripe_card',22,0,22,NULL,lines,NULL,g,'{"email":"test@example.test"}');
 sid:=(a->>'checkout_session_id')::uuid;
 b:=public.checkout_transaction_core(cart,ARRAY[item],'ordinary-b','ordinary-hash','stripe_card',22,0,22,NULL,lines,NULL,g,'{"email":"test@example.test"}');
 IF b->>'checkout_session_id'<>sid::text OR (SELECT reserved FROM public.inventory WHERE variant_id=variant)<>1 THEN RAISE EXCEPTION 'ordinary retry duplicated stock hold'; END IF;
 BEGIN PERFORM public.checkout_transaction_core(cart,ARRAY[item],'ordinary-c','ordinary-hash','stripe_card',44,0,44,NULL,jsonb_set(lines,'{0,quantity}','2'),NULL,g,'{"email":"test@example.test"}'); EXCEPTION WHEN OTHERS THEN err:=SQLERRM; END;
 IF err IS DISTINCT FROM 'active_checkout_exists' THEN RAISE EXCEPTION 'changed quantity reused pending checkout: %',err; END IF;
 PERFORM public.finalize_checkout(sid,'cancelled');
 IF (SELECT reserved FROM public.inventory WHERE variant_id=variant)<>0 THEN RAISE EXCEPTION 'cancelled inventory remained reserved'; END IF;
 UPDATE public.checkout_sessions SET status='requires_action' WHERE id=sid;
 IF (SELECT status FROM public.checkout_sessions WHERE id=sid) IN ('pending_payment','requires_action') THEN RAISE EXCEPTION 'delayed provider creation reopened cancelled ordinary checkout'; END IF;
 -- Late receipt for this ordinary cancelled order also enters manual review.
 UPDATE public.payments SET provider_payment_id='cs_ordinary_late' WHERE order_id=(a->>'order_id')::uuid;
 b:=public.settle_provider_checkout(sid,'stripe','succeeded','cs_ordinary_late','evt_ordinary_late',repeat('d',64),2200,'MYR');
 IF b->>'status'<>'payment_exception' OR NOT EXISTS(SELECT 1 FROM public.event_order_exceptions WHERE checkout_session_id=sid AND reason_code='checkout_hold_expired') THEN RAISE EXCEPTION 'ordinary late payment evidence lost'; END IF;
END; $$;
ROLLBACK;

-- Guest cap and ordinary-core cross-domain guard; expiry opens a new budget.
BEGIN;
SET LOCAL request.jwt.claim.role='service_role';
SET LOCAL request.jwt.claim.sub='';
SET LOCAL request.jwt.claims='{"role":"service_role"}';
DO $$ DECLARE g uuid; c uuid; a jsonb; b jsonb; sid uuid; err text; BEGIN
 INSERT INTO public.guest_checkout_subjects(expires_at) VALUES(now()+interval '1 day') RETURNING id INTO g;
 INSERT INTO public.carts(guest_subject_id) VALUES(g) RETURNING id INTO c;
 a:=public.guest_prepare_event_checkout('77777777-7777-4777-8777-777777777777','2026-10-10','88888888-8888-4888-8888-888888888888',1,'stripe_card','guest-budget-a','guest-a',g,'{"email":"test@example.test"}');
 sid:=(a->>'checkout_session_id')::uuid;
 BEGIN PERFORM public.checkout_transaction_core(c,NULL,'guest-cart-b','different-cart','stripe_card',12,0,12,NULL,'[]',NULL,g,'{"email":"test@example.test"}'); EXCEPTION WHEN OTHERS THEN err:=SQLERRM; END;
 IF err IS DISTINCT FROM 'active_checkout_exists' THEN RAISE EXCEPTION 'ordinary checkout bypassed event budget: %',err; END IF;
 UPDATE public.checkout_sessions SET expires_at=now()-interval '1 minute' WHERE id=sid;
 b:=public.guest_prepare_event_checkout('77777777-7777-4777-8777-777777777777','2026-10-10','88888888-8888-4888-8888-888888888888',1,'stripe_card','guest-budget-b','guest-b',g,'{"email":"test@example.test"}');
 IF b->>'checkout_session_id'=sid::text THEN RAISE EXCEPTION 'expired checkout reused'; END IF;
 PERFORM public.finalize_checkout((b->>'checkout_session_id')::uuid,'cancelled');
 IF EXISTS(SELECT 1 FROM public.checkout_reservations WHERE checkout_session_id=(b->>'checkout_session_id')::uuid AND status='held') THEN RAISE EXCEPTION 'cancellation retained holds'; END IF;
 IF has_function_privilege('authenticated','app_private.reuse_unpaid_checkout(uuid,uuid,text,numeric,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'internal budget exposed'; END IF;
END; $$;
ROLLBACK;
