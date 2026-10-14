ALTER TABLE public.refunds ADD COLUMN reason_code text CHECK(reason_code IN ('schedule_change','mistake','unavailable','dissatisfied','other')),
 ADD COLUMN review_evidence_version text,ADD COLUMN review_claimed_at timestamptz,ADD COLUMN review_claimed_by uuid REFERENCES public.users(id);
CREATE FUNCTION app_private.event_refund_evidence(p_refund uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE items jsonb; evidence jsonb; oid uuid; BEGIN
 SELECT order_id INTO oid FROM public.refunds WHERE id=p_refund;
 SELECT coalesce(jsonb_agg(jsonb_build_object('name',oi.product_name,'quantity',oi.quantity,'status',oi.fulfil_status,
 'collectedAt',oi.fulfilled_at,'venue',l.name,'pickupDate',oi.pickup_date,'pickupWindow',oi.variant_name,
 'vendor',v.name,'scannedBy',(SELECT u.full_name FROM public.audit_logs a JOIN public.users u ON u.id=a.actor_id
 WHERE a.entity_id=oid AND a.action='event_pickup.fulfilled' AND (a.after_data->>'vendor_id')=oi.vendor_id::text
 AND a.after_data->>'location_id'=oi.event_location_id::text AND a.after_data->>'pickup_date'=oi.pickup_date::text
 AND (a.after_data->>'pickup_slot_id' IS NULL OR a.after_data->>'pickup_slot_id'=oi.pickup_slot_id::text)
 ORDER BY a.created_at DESC LIMIT 1)) ORDER BY oi.id),'[]'::jsonb) INTO items
 FROM public.order_items oi LEFT JOIN public.promotion_campaign_locations l ON l.id=oi.event_location_id
 LEFT JOIN public.vendors v ON v.id=oi.vendor_id WHERE oi.order_id=oid AND oi.event_location_id IS NOT NULL;
 SELECT jsonb_build_object('items',items,'orderStatus',o.status,'refundStatus',r.status,'refundUpdatedAt',r.updated_at,'scope',r.refund_scope)
 INTO evidence FROM public.refunds r JOIN public.orders o ON o.id=r.order_id WHERE r.id=p_refund;
 RETURN coalesce(evidence,'{}'::jsonb)||jsonb_build_object('version',md5(coalesce(evidence::text,'')));
END; $$;
REVOKE ALL ON FUNCTION app_private.event_refund_evidence(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.get_event_refund_evidence(p_refund uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
 RETURN app_private.event_refund_evidence(p_refund);
END; $$;
REVOKE ALL ON FUNCTION public.get_event_refund_evidence(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_refund_evidence(uuid) TO service_role;

CREATE FUNCTION public.claim_event_refund_review(p_refund uuid,p_actor uuid,p_version text,p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.refunds%ROWTYPE; e jsonb; BEGIN
 IF coalesce(auth.role(),'')<>'service_role' OR p_actor IS NULL OR NOT public.is_super_admin(p_actor) THEN RAISE EXCEPTION 'super_admin_required'; END IF;
 SELECT * INTO r FROM public.refunds WHERE id=p_refund FOR UPDATE;
 IF NOT FOUND OR r.status<>'pending' THEN RAISE EXCEPTION 'refund_not_pending'; END IF;
 PERFORM id FROM public.orders WHERE id=r.order_id FOR UPDATE;
 e:=app_private.event_refund_evidence(r.id);
 IF jsonb_array_length(e->'items')=0 THEN RETURN jsonb_build_object('event',false); END IF;
 IF p_version IS NULL OR p_version IS DISTINCT FROM e->>'version' THEN RAISE EXCEPTION 'refund_evidence_changed'; END IF;
 IF EXISTS(SELECT 1 FROM public.order_items WHERE order_id=r.order_id AND fulfil_status='fulfilled')
 AND length(btrim(coalesce(p_note,'')))<5 THEN RAISE EXCEPTION 'collected_refund_note_required'; END IF;
 UPDATE public.refunds SET review_evidence_version=p_version,review_claimed_at=now(),review_claimed_by=p_actor,
 review_note=nullif(btrim(p_note),'') WHERE id=r.id;
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,after_data,note)
 VALUES(p_actor,'event_refund.review_claimed','refund',r.id,jsonb_build_object('evidenceVersion',p_version),p_note);
 RETURN jsonb_build_object('event',true,'version',p_version);
END; $$;
REVOKE ALL ON FUNCTION public.claim_event_refund_review(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_event_refund_review(uuid,uuid,text,text) TO service_role;

CREATE FUNCTION public.request_order_refund_with_reason(p_order uuid,p_user uuid,p_guest uuid,p_reason text,p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb; BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
 IF num_nonnulls(p_user,p_guest)<>1 OR p_code NOT IN ('schedule_change','mistake','unavailable','dissatisfied','other') OR p_code IS NULL THEN RAISE EXCEPTION 'refund_request_invalid'; END IF;
 IF p_guest IS NOT NULL THEN result:=public.guest_request_order_refund(p_order,p_guest,p_reason);
 ELSE result:=public.request_order_refund(p_order,p_user,p_reason); END IF;
 UPDATE public.refunds SET reason_code=p_code WHERE id=(result->>'id')::uuid;
 RETURN result||jsonb_build_object('reason_code',p_code);
END; $$;
REVOKE ALL ON FUNCTION public.request_order_refund_with_reason(uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.request_order_refund_with_reason(uuid,uuid,uuid,text,text) TO service_role;

-- Pickup has already locked the order: the review claim becomes the durable
-- boundary while a provider request is in flight, without holding a DB lock
-- across network calls. No automatic lease expiry may reopen pickup.
DO $patch$ DECLARE f record; src text; changed text; n integer:=0; BEGIN
 FOR f IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
 WHERE n.nspname IN ('public','app_private') AND p.proname='fulfil_event_pickup' AND l.lanname='plpgsql' LOOP
 src:=replace(pg_get_functiondef(f.oid),E'\r','');
 IF position('FOR UPDATE' IN src)=0 OR position('v_status' IN src)=0 THEN RAISE EXCEPTION 'pickup_review_preflight_required'; END IF;
 changed:=replace(src,'  IF p_pickup_date IS DISTINCT FROM v_today',E'  IF EXISTS(SELECT 1 FROM public.refunds WHERE order_id=p_order_id AND review_claimed_at IS NOT NULL AND status IN (''pending'',''approved'')) THEN RAISE EXCEPTION ''event_refund_under_review''; END IF;\n  IF p_pickup_date IS DISTINCT FROM v_today');
 IF changed=src THEN RAISE EXCEPTION 'pickup_review_patch_failed'; END IF;
 EXECUTE changed;n:=n+1;
 END LOOP;
 IF n<>1 THEN RAISE EXCEPTION 'pickup_review_installation_required'; END IF;
END; $patch$;
NOTIFY pgrst,'reload schema';
CREATE FUNCTION public.assert_event_refund_review(p_refund uuid,p_actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE r public.refunds%ROWTYPE; BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
 SELECT * INTO r FROM public.refunds WHERE id=p_refund FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.order_items WHERE order_id=r.order_id AND event_location_id IS NOT NULL) THEN RETURN; END IF;
 IF p_actor IS NOT NULL THEN
  IF NOT public.is_super_admin(p_actor) OR r.review_claimed_by IS DISTINCT FROM p_actor OR r.review_claimed_at IS NULL THEN RAISE EXCEPTION 'event_refund_review_required'; END IF;
 ELSIF NOT r.auto_process THEN RAISE EXCEPTION 'event_refund_review_required'; END IF;
END; $$;
REVOKE ALL ON FUNCTION public.assert_event_refund_review(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.assert_event_refund_review(uuid,uuid) TO service_role;
CREATE FUNCTION public.reject_order_refund_review(p_refund uuid,p_actor uuid,p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE r public.refunds%ROWTYPE; BEGIN
 IF coalesce(auth.role(),'')<>'service_role' OR p_actor IS NULL OR NOT public.is_super_admin(p_actor) THEN RAISE EXCEPTION 'super_admin_required'; END IF;
 SELECT * INTO r FROM public.refunds WHERE id=p_refund FOR UPDATE;
 IF NOT FOUND OR r.status<>'pending' OR r.review_claimed_at IS NOT NULL OR r.provider_refund_id IS NOT NULL OR r.refund_scope='event_payment_compensation' THEN RAISE EXCEPTION 'refund_review_in_flight'; END IF;
 UPDATE public.refunds SET status='rejected',processed_by=p_actor,processed_at=now(),review_note=p_note,updated_at=now() WHERE id=r.id;
 RETURN jsonb_build_object('refundId',r.id,'status','rejected');
END; $$;
REVOKE ALL ON FUNCTION public.reject_order_refund_review(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reject_order_refund_review(uuid,uuid,text) TO service_role;
