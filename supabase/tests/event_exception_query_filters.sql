SET LOCAL request.jwt.claim.role='service_role';
DO $$ DECLARE
 actor uuid:='00000000-0000-0000-0000-000000000001'; ord uuid;
 result jsonb; page2 jsonb; err text; pending_refund uuid; failed_refund uuid; pay uuid;
 BEGIN
 SELECT id INTO ord FROM public.orders LIMIT 1;
 DELETE FROM public.event_order_exceptions;
 INSERT INTO public.event_order_exceptions(source_key,kind,order_id,reason_code,verified_amount_sen,created_at)
 SELECT 'filter-'||n,'refund_attention',ord,'refund_review_required',100,now()+n*interval '1 second' FROM generate_series(1,110) n;
 INSERT INTO public.event_order_exceptions(source_key,kind,order_id,reason_code,verified_amount_sen,assigned_to,due_at,created_at)
 VALUES('last-matching-case','payment_unfulfillable',ord,'event_hold_expired',200,actor,now()-interval '1 hour',now()+interval '1 day');
 result:=public.get_event_reservation_operations_filtered(actor,'{"caseKind":"payment_unfulfillable","caseOwner":"mine","caseDeadline":"overdue"}');
 IF (result->>'total')::int<>1 OR (result->>'matchingOutstandingSen')::bigint<>200 OR jsonb_array_length(result->'cases')<>1 THEN RAISE EXCEPTION 'filter beyond first 100 failed: %',result; END IF;
 IF (result->'summary'->>'open')::int<>111 THEN RAISE EXCEPTION 'global obligations hidden by filter'; END IF;
 result:=public.get_event_reservation_operations_filtered(actor,'{}');
 page2:=public.get_event_reservation_operations_filtered(actor,'{"casePage":2}');
 IF (result->>'total')::int<>111 OR (result->>'matchingOutstandingSen')::bigint<>11200 OR jsonb_array_length(result->'cases')<>25 THEN RAISE EXCEPTION 'count/amount calculated after paging'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(result->'cases') a JOIN jsonb_array_elements(page2->'cases') b ON a->>'id'=b->>'id') THEN RAISE EXCEPTION 'unstable pages'; END IF;
 result:=public.get_event_reservation_operations_filtered(actor,'{"caseSearch":"%"}');
 IF (result->>'total')::int<>0 THEN RAISE EXCEPTION 'wildcard became unrestricted search'; END IF;
 result:=public.get_event_reservation_operations_filtered(actor,'{"casePage":1000000}');
 IF (result->>'page')::int<>5 OR jsonb_array_length(result->'cases')<>11 THEN RAISE EXCEPTION 'page not clamped'; END IF;
 SELECT id INTO pay FROM public.payments WHERE order_id=ord LIMIT 1;
 INSERT INTO public.refunds(order_id,payment_id,amount,reason,status,provider_refund_id)
 VALUES(ord,pay,1,'Waiting for provider','approved','re_filter_pending') RETURNING id INTO pending_refund;
 INSERT INTO public.refunds(order_id,payment_id,amount,reason,status,provider_refund_id)
 VALUES(ord,pay,1,'Failed without failure code','rejected','re_filter_failed') RETURNING id INTO failed_refund;
 DELETE FROM public.event_order_exceptions WHERE source_key NOT IN ('last-matching-case');
 INSERT INTO public.event_order_exceptions(source_key,kind,order_id,reason_code,refund_id,verified_amount_sen)
 VALUES('filter-provider-pending','refund_attention',ord,'refund_review_required',pending_refund,100),
 ('filter-provider-failed','refund_attention',ord,'refund_review_required',failed_refund,100);
 result:=public.get_event_reservation_operations_filtered(actor,'{"caseHandling":"awaiting_provider"}');
 IF (result->>'total')::int<>1 OR result->'cases'->0->>'refundId'<>pending_refund::text THEN RAISE EXCEPTION 'failed refund labeled waiting'; END IF;
 result:=public.get_event_reservation_operations_filtered(actor,'{"caseHandling":"refund_failed"}');
 IF (result->>'total')::int<>1 THEN RAISE EXCEPTION 'failure with no code lost'; END IF;
 UPDATE public.refunds SET status='processed' WHERE id=pending_refund;
 -- A fixture case without payment association uses the same durable closure state.
 UPDATE public.event_order_exceptions SET state='resolved',resolved_at=now() WHERE refund_id=pending_refund;
 result:=public.get_event_reservation_operations_filtered(actor,'{"caseHandling":"resolved"}');
 IF (result->>'total')::int<>1 OR (result->>'matchingOutstandingSen')::bigint<>0 OR result->'cases'->0->>'handling'<>'resolved' THEN RAISE EXCEPTION 'processed refund not discoverable'; END IF;
 err:=NULL;
 BEGIN PERFORM public.get_event_reservation_operations_filtered(actor,'{"actor":"evil"}'); EXCEPTION WHEN OTHERS THEN err:=SQLERRM; END;
 IF err IS DISTINCT FROM 'event_exception_filters_invalid' THEN RAISE EXCEPTION 'extra key accepted'; END IF;
 err:=NULL;
 BEGIN PERFORM public.get_event_reservation_operations_filtered('00000000-0000-0000-0000-000000000004','{}'); EXCEPTION WHEN OTHERS THEN err:=SQLERRM; END;
 IF err IS DISTINCT FROM 'super_admin_required' THEN RAISE EXCEPTION 'non-admin read allowed'; END IF;
 IF has_function_privilege('anon','public.get_event_reservation_operations_filtered(uuid,jsonb)','EXECUTE') OR has_function_privilege('authenticated','public.get_event_reservation_operations_filtered(uuid,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'case query exposed'; END IF;
 END $$;
