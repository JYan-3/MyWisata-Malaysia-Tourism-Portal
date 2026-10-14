SET LOCAL request.jwt.claim.role='service_role';
DO $$ DECLARE c uuid; result jsonb; err text; BEGIN
 INSERT INTO public.event_order_exceptions(source_key,kind,order_id,reason_code)
 SELECT 'ops-test','refund_attention',id,'refund_failed' FROM public.orders LIMIT 1 RETURNING id INTO c;
 BEGIN PERFORM public.update_event_order_exception(c,'00000000-0000-0000-0000-000000000004',1,'claim',now()+interval '1 day',NULL); EXCEPTION WHEN OTHERS THEN err:=SQLERRM; END;
 IF err IS DISTINCT FROM 'super_admin_required' THEN RAISE EXCEPTION 'case permission bypass: %',err; END IF;
 result:=public.update_event_order_exception(c,'00000000-0000-0000-0000-000000000001',1,'claim',now()+interval '1 day',NULL);
 err:=NULL;
 BEGIN PERFORM public.update_event_order_exception(c,'00000000-0000-0000-0000-000000000001',1,'claim',now()+interval '1 day',NULL); EXCEPTION WHEN OTHERS THEN err:=SQLERRM; END;
 IF err IS DISTINCT FROM 'event_exception_changed' THEN RAISE EXCEPTION 'case claim overwrite'; END IF;
 err:=NULL;
 BEGIN PERFORM public.update_event_order_exception(c,'00000000-0000-0000-0000-000000000001',2,'resolve',NULL,'Clicking done is not evidence'); EXCEPTION WHEN OTHERS THEN err:=SQLERRM; END;
 IF err IS DISTINCT FROM 'event_exception_obligation_outstanding' THEN RAISE EXCEPTION 'unpaid obligation closed: %',err; END IF;
 IF has_table_privilege('authenticated','public.event_order_exceptions','SELECT') OR has_function_privilege('anon','public.update_event_order_exception(uuid,uuid,integer,text,timestamptz,text)','EXECUTE') THEN RAISE EXCEPTION 'operational data exposed'; END IF;
  INSERT INTO public.refunds(order_id,payment_id,amount,reason,status,provider_refund_id)
 SELECT oi.order_id,p.id,12,'Provider failed without code','rejected','re_failed_no_code' FROM public.order_items oi JOIN public.payments p ON p.order_id=oi.order_id WHERE oi.event_location_id IS NOT NULL LIMIT 1;
 IF NOT EXISTS(SELECT 1 FROM public.event_order_exceptions e JOIN public.refunds r ON r.id=e.refund_id WHERE r.provider_refund_id='re_failed_no_code' AND e.state='open') THEN RAISE EXCEPTION 'provider failure without code disappeared'; END IF;
END $$;
