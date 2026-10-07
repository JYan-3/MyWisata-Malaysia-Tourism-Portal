-- Run only against a disposable, fully migrated database. All fixture changes
-- are rolled back. This exercises real grants, constraints and single-use RPCs.
BEGIN;
SET LOCAL "request.jwt.claims" = '{"role":"service_role"}';
DO $$
DECLARE g UUID; o UUID; s UUID; result UUID; failures INTEGER:=0;
BEGIN
 IF has_table_privilege('anon','public.guest_checkout_subjects','SELECT') OR has_table_privilege('authenticated','public.guest_order_access_tokens','SELECT') THEN RAISE EXCEPTION 'guest private tables exposed'; END IF;
 IF has_function_privilege('anon','public.guest_prepare_event_checkout(uuid,date,uuid,integer,text,text,text,uuid,jsonb)','EXECUTE') OR has_function_privilege('authenticated','public.checkout_transaction_core(uuid,uuid[],text,text,text,numeric,numeric,numeric,text,jsonb,uuid,uuid,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'guest cores exposed'; END IF;
 INSERT INTO public.guest_checkout_subjects(token_hash,expires_at) VALUES(repeat('a',64),now()+interval '1 day') RETURNING id INTO g;
 BEGIN INSERT INTO public.carts(user_id,guest_subject_id) VALUES(NULL,NULL); RAISE EXCEPTION 'owner xor not enforced'; EXCEPTION WHEN check_violation THEN failures:=failures+1; END;
 INSERT INTO public.orders(user_id,guest_subject_id,contact_email,status,subtotal,discount_amount,total_amount,payment_method) VALUES(NULL,g,'guest-fixture@example.com','paid',0,0,0,'free_reservation') RETURNING id INTO o;
 IF (SELECT count(*) FROM public.email_outbox WHERE event_key='guest-order-confirmation:'||o)<>1 THEN RAISE EXCEPTION 'missing durable guest confirmation'; END IF;
 PERFORM public.queue_guest_order_access(o,'guest-order-confirmation:'||o,NULL);
 IF (SELECT count(*) FROM public.email_outbox WHERE event_key='guest-order-confirmation:'||o)<>1 THEN RAISE EXCEPTION 'duplicate confirmation'; END IF;
 INSERT INTO public.guest_order_access_tokens(order_id,token_hash,expires_at) VALUES(o,repeat('b',64),now()+interval '1 day');
 result:=public.exchange_guest_order_access(repeat('b',64),repeat('c',64));
 IF result IS DISTINCT FROM o THEN RAISE EXCEPTION 'valid exchange failed'; END IF;
 result:=public.exchange_guest_order_access(repeat('b',64),repeat('d',64));
 IF result IS NOT NULL THEN RAISE EXCEPTION 'single use token replay'; END IF;
 INSERT INTO public.guest_order_access_tokens(order_id,token_hash,expires_at) VALUES(o,repeat('e',64),now()-interval '1 second');
 IF public.exchange_guest_order_access(repeat('e',64),repeat('f',64)) IS NOT NULL THEN RAISE EXCEPTION 'expired token accepted'; END IF;
 UPDATE public.guest_checkout_subjects SET revoked_at=now() WHERE id=g;
 BEGIN
  PERFORM public.guest_prepare_event_checkout(gen_random_uuid(),current_date,gen_random_uuid(),1,'free_reservation','expired-subject','fixture',g,'{"email":"guest-fixture@example.com"}');
  RAISE EXCEPTION 'revoked guest accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'checkout_not_owned' THEN RAISE; END IF; END;
 RAISE NOTICE 'guest ownership, grants, durable mail and access replay checks passed';
END; $$;
ROLLBACK;
