SET LOCAL request.jwt.claim.role='service_role';
SET LOCAL request.jwt.claims='{"role":"service_role"}';
DO $$
<<guest_refund_compatibility>>
DECLARE guest uuid:=gen_random_uuid(); order_id uuid:=gen_random_uuid();
  failed_order uuid:=gen_random_uuid(); result jsonb; message text;
BEGIN
  IF has_function_privilege('anon','public.guest_request_order_refund(uuid,uuid,text)','execute')
    OR has_function_privilege('authenticated','public.guest_request_order_refund(uuid,uuid,text)','execute')
    OR NOT has_function_privilege('service_role','public.guest_request_order_refund(uuid,uuid,text)','execute') THEN
    RAISE EXCEPTION 'Guest refund function grants are unsafe';
  END IF;
  INSERT INTO public.orders(id,user_id,guest_subject_id,status,subtotal,total_amount)
    VALUES(order_id,NULL,guest,'paid',25,25),(failed_order,NULL,guest,'paid',25,25);
  INSERT INTO public.payments(order_id,method,provider,amount,status,idempotency_key)
    VALUES(order_id,'mock_card','platform',25,'succeeded',gen_random_uuid()::text),
    (failed_order,'mock_card','platform',25,'succeeded',gen_random_uuid()::text);
  BEGIN
    PERFORM public.guest_request_order_refund(order_id,gen_random_uuid(),'Wrong Guest');
  EXCEPTION WHEN OTHERS THEN message:=SQLERRM; END;
  IF message IS DISTINCT FROM 'refund_order_not_owned' THEN RAISE EXCEPTION 'Cross-Guest refund was not denied: %',message; END IF;
  result:=public.guest_request_order_refund(order_id,guest,'Cancel purchase');
  IF result->>'status'<>'pending' OR (result->>'external_amount_sen')::bigint<>2500
    OR NOT EXISTS(SELECT 1 FROM public.refunds WHERE id=(result->>'id')::uuid AND funding_snapshot_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Guest refund lost its funding snapshot';
  END IF;
  message:=NULL;
  BEGIN PERFORM public.guest_request_order_refund(order_id,guest,'Duplicate refund');
  EXCEPTION WHEN OTHERS THEN message:=SQLERRM; END;
  IF message IS DISTINCT FROM 'refund_already_active' OR (SELECT count(*) FROM public.refunds WHERE refunds.order_id=guest_refund_compatibility.order_id)>1 THEN
    RAISE EXCEPTION 'Guest refund active-request guard was lost';
  END IF;
  PERFORM set_config('fixture.fail_refund_snapshot','true',true);
  message:=NULL;
  BEGIN PERFORM public.guest_request_order_refund(failed_order,guest,'Broken funding');
  EXCEPTION WHEN OTHERS THEN message:=SQLERRM; END;
  IF message IS DISTINCT FROM 'refund_funding_ledger_mismatch' OR EXISTS(SELECT 1 FROM public.refunds WHERE refunds.order_id=failed_order) THEN
    RAISE EXCEPTION 'Failed funding snapshot did not roll back the refund';
  END IF;
END; $$;
