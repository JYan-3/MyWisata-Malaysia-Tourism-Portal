SET LOCAL request.jwt.claim.role='service_role';
DO $$ DECLARE refund uuid; evidence jsonb; err text; BEGIN
 INSERT INTO public.refunds(order_id,payment_id,amount,reason,status)
 SELECT oi.order_id,p.id,12,'Review fixture','pending' FROM public.order_items oi JOIN public.payments p ON p.order_id=oi.order_id
 WHERE oi.event_location_id IS NOT NULL LIMIT 1 RETURNING id INTO refund;
 IF refund IS NULL THEN RAISE EXCEPTION 'refund evidence fixture unavailable'; END IF;
 evidence:=public.get_event_refund_evidence(refund);
 IF jsonb_array_length(evidence->'items')<1 OR evidence->>'version' IS NULL THEN RAISE EXCEPTION 'refund evidence missing'; END IF;
 BEGIN PERFORM public.claim_event_refund_review(refund,'00000000-0000-0000-0000-000000000001','stale','Valid review note'); EXCEPTION WHEN OTHERS THEN err:=SQLERRM; END;
 IF err IS DISTINCT FROM 'refund_evidence_changed' THEN RAISE EXCEPTION 'stale refund review accepted: %',err; END IF;
END $$;
