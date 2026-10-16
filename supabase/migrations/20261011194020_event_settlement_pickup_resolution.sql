-- Extend existing obligations; never infer a customer no-show from time alone.
ALTER TABLE public.event_order_exceptions DROP CONSTRAINT event_order_exceptions_kind_check;
ALTER TABLE public.event_order_exceptions ADD CONSTRAINT event_order_exceptions_kind_check CHECK(kind IN ('payment_unfulfillable','refund_attention','pickup_overdue'));
ALTER TABLE public.event_order_exceptions ADD COLUMN resolution_code text CHECK(resolution_code IN ('customer_no_show','collected','refunded')), ADD COLUMN resolution_evidence jsonb;

CREATE FUNCTION app_private.event_settlement_release_allowed(p_order uuid,p_vendor uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT NOT EXISTS(SELECT 1 FROM public.order_items WHERE order_id=p_order AND vendor_id=p_vendor AND event_location_id IS NOT NULL)
 OR (
 NOT EXISTS(SELECT 1 FROM public.refunds WHERE order_id=p_order AND (status IN ('pending','approved') OR (status<>'processed' AND (nullif(btrim(provider_failure_code),'') IS NOT NULL OR nullif(btrim(provider_failure_message),'') IS NOT NULL OR nullif(btrim(provider_refund_id),'') IS NOT NULL))))
 AND NOT EXISTS(SELECT 1 FROM public.event_order_exceptions WHERE order_id=p_order AND state='open')
 AND NOT EXISTS(SELECT 1 FROM public.order_items oi WHERE oi.order_id=p_order AND oi.vendor_id=p_vendor AND oi.event_location_id IS NOT NULL
 AND NOT ((oi.fulfil_status='fulfilled' AND oi.fulfilled_at IS NOT NULL) OR (oi.fulfil_status IN ('pending','ready') AND oi.pickup_date<(now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date
 AND EXISTS(SELECT 1 FROM public.event_order_exceptions e WHERE e.order_id=p_order AND e.kind='pickup_overdue' AND e.state='resolved' AND e.resolution_code='customer_no_show'
 AND e.resolution_evidence @> jsonb_build_array(jsonb_build_object('id',oi.id,'quantity',oi.quantity,'pickupDate',oi.pickup_date))))))
 );
$$;
REVOKE ALL ON FUNCTION app_private.event_settlement_release_allowed(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Preserve the installed clearer, fee calculations and ledger entries.
DO $patch$ DECLARE src text; changed text; BEGIN
 src:=replace(pg_get_functiondef('public.clear_matured_vendor_settlements(boolean)'::regprocedure),E'\r','');
 IF position('FOR UPDATE OF s SKIP LOCKED' IN src)=0 OR position('-- Matured hold: move held -> spendable.' IN src)=0 OR position('settlement_id := v_row.id;' IN src)=0 THEN RAISE EXCEPTION 'event_clearance_definition_drift'; END IF;
 changed:=replace(src,'FOR UPDATE OF s SKIP LOCKED','');
 changed:=replace(changed,'settlement_id := v_row.id;', $body$
    -- Order first matches pickup/refund lock order; recheck after any wait.
    PERFORM 1 FROM public.orders WHERE id=v_row.order_id FOR UPDATE;
    PERFORM 1 FROM public.order_settlements WHERE id=v_row.id AND status='pending' FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;
    SELECT lower(status) INTO v_row.order_status FROM public.orders WHERE id=v_row.order_id;
    SELECT vendor_net_sen,reversed_amount_sen INTO v_row.vendor_net_sen,v_row.reversed_amount_sen FROM public.order_settlements WHERE id=v_row.id;
    settlement_id := v_row.id;
 $body$);
 changed:=replace(changed,'-- Matured hold: move held -> spendable.', $body$
    IF NOT app_private.event_settlement_release_allowed(v_row.order_id,(SELECT vendor_id FROM public.order_settlements WHERE id=v_row.id))
     OR EXISTS(SELECT 1 FROM public.order_settlements s JOIN public.order_items oi ON oi.order_id=s.order_id AND oi.vendor_id=s.vendor_id
      WHERE s.id=v_row.id AND oi.event_location_id IS NOT NULL AND (s.hold_until IS NULL OR s.hold_until>now())) THEN CONTINUE; END IF;
    -- Matured hold: move held -> spendable.
 $body$);
 EXECUTE changed;
END; $patch$;

-- Book the authoritative vendor reversal before its bucket debit, atomically.
-- This releases only that order's reserve and keeps the guard fail-closed for
-- unrelated recommendation/affiliate reversals sharing the wallet.
DO $patch$ DECLARE src text; reversed text; BEGIN
 src:=replace(pg_get_functiondef('public.reverse_order_vendor_settlement(uuid,bigint)'::regprocedure),E'\r','');
 reversed:=$body$    UPDATE public.order_settlements
       SET reversed_amount_sen = reversed_amount_sen + v_target,
           status = CASE WHEN reversed_amount_sen + v_target >= vendor_net_sen THEN 'reversed' ELSE status END,
           reversed_at = CASE WHEN reversed_amount_sen + v_target >= vendor_net_sen THEN now() ELSE reversed_at END
     WHERE id = v_row.id;$body$;
 IF position(reversed IN src)=0 OR position('    IF v_from_pending > 0 THEN' IN src)=0
 OR position('FROM public.orders WHERE id = p_order_id;' IN src)=0 THEN RAISE EXCEPTION 'event_reversal_definition_drift'; END IF;
 src:=replace(src,reversed,'');
 src:=replace(src,'FROM public.orders WHERE id = p_order_id;','FROM public.orders WHERE id = p_order_id FOR UPDATE;');
 src:=replace(src,'    IF v_from_pending > 0 THEN',reversed||E'\n    IF v_from_pending > 0 THEN');
 EXECUTE src;
END; $patch$;

-- Shared-bucket releases may consume only funds beyond reserved event net.
CREATE FUNCTION app_private.protect_event_pending_funds() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE reserved bigint; BEGIN
 IF NEW.pending_earnings_sen<OLD.pending_earnings_sen THEN
 SELECT coalesce(sum(s.vendor_net_sen-s.reversed_amount_sen),0) INTO reserved FROM public.order_settlements s JOIN public.vendors v ON v.id=s.vendor_id JOIN public.orders o ON o.id=s.order_id
 WHERE v.owner_id=NEW.user_id AND s.status='pending' AND NOT s.is_simulated AND lower(o.status) IN ('paid','completed')
 AND EXISTS(SELECT 1 FROM public.order_items oi WHERE oi.order_id=s.order_id AND oi.vendor_id=s.vendor_id AND oi.event_location_id IS NOT NULL)
 AND (s.hold_until IS NULL OR s.hold_until>now() OR NOT app_private.event_settlement_release_allowed(s.order_id,s.vendor_id));
 IF NEW.pending_earnings_sen<reserved THEN RAISE EXCEPTION 'event_funds_reserved'; END IF;
 END IF; RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION app_private.protect_event_pending_funds() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER protect_event_pending_funds BEFORE UPDATE OF pending_earnings_sen,earnings_sen ON public.wallets FOR EACH ROW EXECUTE FUNCTION app_private.protect_event_pending_funds();

CREATE FUNCTION public.refresh_overdue_event_pickups() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE o record; opened integer:=0; closed integer:=0; n integer; pid uuid; rid uuid; BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
 FOR o IN SELECT ord.id,ord.total_amount FROM public.orders ord WHERE lower(ord.status) IN ('paid','completed')
 AND EXISTS(SELECT 1 FROM public.order_items oi WHERE oi.order_id=ord.id AND oi.event_location_id IS NOT NULL AND oi.fulfil_status IN ('pending','ready') AND oi.pickup_date<(now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date)
 ORDER BY ord.id FOR UPDATE OF ord LOOP
 IF NOT EXISTS(SELECT 1 FROM public.order_items WHERE order_id=o.id AND event_location_id IS NOT NULL AND fulfil_status IN ('pending','ready') AND pickup_date<(now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date) THEN CONTINUE; END IF;
 SELECT id INTO pid FROM public.payments WHERE order_id=o.id AND status='succeeded' ORDER BY created_at DESC,id LIMIT 1;
 SELECT id INTO rid FROM public.refunds WHERE order_id=o.id ORDER BY created_at DESC,id LIMIT 1;
 IF NOT EXISTS(SELECT 1 FROM public.event_order_exceptions WHERE order_id=o.id AND state='open') THEN
 INSERT INTO public.event_order_exceptions(source_key,kind,order_id,payment_id,refund_id,verified_amount_sen,verified_currency,reason_code)
 VALUES('event-pickup:'||o.id,'pickup_overdue',o.id,pid,rid,CASE WHEN o.total_amount>0 THEN round(o.total_amount*100)::bigint END,'MYR','pickup_outcome_unconfirmed') ON CONFLICT(source_key) DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT; opened:=opened+n;
 END IF; END LOOP;
 FOR o IN SELECT ord.id FROM public.orders ord WHERE EXISTS(SELECT 1 FROM public.event_order_exceptions e WHERE e.order_id=ord.id AND e.kind='pickup_overdue' AND e.state='open') ORDER BY ord.id FOR UPDATE OF ord LOOP
 IF EXISTS(SELECT 1 FROM public.refunds WHERE order_id=o.id AND status='processed') THEN
 UPDATE public.event_order_exceptions SET state='resolved',resolution_code='refunded',resolved_at=now(),resolution_note='Refund completion verified',version=version+1,updated_at=now() WHERE order_id=o.id AND kind='pickup_overdue' AND state='open';
 ELSIF NOT EXISTS(SELECT 1 FROM public.refunds WHERE order_id=o.id AND (status IN ('pending','approved') OR (status<>'processed' AND (provider_failure_code IS NOT NULL OR provider_failure_message IS NOT NULL OR provider_refund_id IS NOT NULL)))) AND NOT EXISTS(SELECT 1 FROM public.order_items WHERE order_id=o.id AND event_location_id IS NOT NULL AND (fulfil_status<>'fulfilled' OR fulfilled_at IS NULL)) THEN
 UPDATE public.event_order_exceptions SET state='resolved',resolution_code='collected',resolved_at=now(),resolution_note='Recorded pickup verified',version=version+1,updated_at=now() WHERE order_id=o.id AND kind='pickup_overdue' AND state='open';
 ELSE CONTINUE; END IF; GET DIAGNOSTICS n=ROW_COUNT; closed:=closed+n;
 END LOOP;
 RETURN jsonb_build_object('opened',opened,'closed',closed);
END; $$;
REVOKE ALL ON FUNCTION public.refresh_overdue_event_pickups() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_overdue_event_pickups() TO service_role;

-- Reuse a pickup case for subsequent refund work, retaining ownership/deadline.
CREATE FUNCTION app_private.link_pickup_refund_attention() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
 UPDATE public.event_order_exceptions SET refund_id=NEW.id,version=version+1,updated_at=now()
 WHERE order_id=NEW.order_id AND kind='pickup_overdue' AND state='open' AND refund_id IS DISTINCT FROM NEW.id;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION app_private.link_pickup_refund_attention() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER event_refund_00_pickup_link AFTER INSERT OR UPDATE ON public.refunds FOR EACH ROW EXECUTE FUNCTION app_private.link_pickup_refund_attention();

CREATE OR REPLACE FUNCTION public.update_event_order_exception(p_case uuid,p_actor uuid,p_version integer,p_action text,p_due timestamptz,p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c public.event_order_exceptions%ROWTYPE; oid uuid; evidence jsonb; resolution text; BEGIN
 IF coalesce(auth.role(),'')<>'service_role' OR p_actor IS NULL OR NOT public.is_super_admin(p_actor) THEN RAISE EXCEPTION 'super_admin_required'; END IF;
 SELECT order_id INTO oid FROM public.event_order_exceptions WHERE id=p_case;
 IF NOT FOUND THEN RAISE EXCEPTION 'event_exception_not_found'; END IF;
 PERFORM 1 FROM public.orders WHERE id=oid FOR UPDATE;
 SELECT * INTO c FROM public.event_order_exceptions WHERE id=p_case FOR UPDATE;
 IF c.version IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'event_exception_changed'; END IF;
 IF c.state<>'open' THEN RAISE EXCEPTION 'event_exception_closed'; END IF;
 IF p_action='claim' THEN
 IF c.assigned_to IS NOT NULL AND c.assigned_to<>p_actor THEN RAISE EXCEPTION 'event_exception_already_assigned'; END IF;
 IF p_due IS NULL OR p_due<=now() THEN RAISE EXCEPTION 'event_exception_due_invalid'; END IF;
 UPDATE public.event_order_exceptions SET assigned_to=p_actor,due_at=p_due,version=version+1,updated_at=now() WHERE id=c.id;
 ELSIF p_action IN ('resolve','confirm_no_show') THEN
 IF c.assigned_to IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'event_exception_owner_required'; END IF;
 IF length(btrim(coalesce(p_note,''))) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'event_exception_note_required'; END IF;
 IF p_action='confirm_no_show' THEN
 IF c.kind<>'pickup_overdue' OR length(btrim(p_note))<20 OR NOT EXISTS(SELECT 1 FROM public.orders WHERE id=oid AND lower(status) IN ('paid','completed'))
 OR EXISTS(SELECT 1 FROM public.refunds WHERE order_id=oid AND (status IN ('pending','approved','processed') OR provider_failure_code IS NOT NULL OR provider_failure_message IS NOT NULL OR provider_refund_id IS NOT NULL))
 OR EXISTS(SELECT 1 FROM public.event_order_exceptions WHERE order_id=oid AND state='open' AND id<>c.id)
 OR EXISTS(SELECT 1 FROM public.order_items WHERE order_id=oid AND event_location_id IS NOT NULL AND fulfil_status<>'fulfilled' AND (fulfil_status NOT IN ('pending','ready') OR pickup_date>=(now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date)) THEN RAISE EXCEPTION 'event_exception_obligation_outstanding'; END IF;
 SELECT jsonb_agg(jsonb_build_object('id',id,'quantity',quantity,'pickupDate',pickup_date) ORDER BY id) INTO evidence FROM public.order_items WHERE order_id=oid AND event_location_id IS NOT NULL AND fulfil_status IN ('pending','ready');
 IF evidence IS NULL THEN RAISE EXCEPTION 'event_exception_obligation_outstanding'; END IF;
 resolution:='customer_no_show';
 ELSIF EXISTS(SELECT 1 FROM public.refunds WHERE id=c.refund_id AND status='processed') THEN resolution:='refunded';
 ELSIF c.kind='pickup_overdue' AND NOT EXISTS(SELECT 1 FROM public.refunds WHERE order_id=oid AND (status IN ('pending','approved') OR (status<>'processed' AND (provider_failure_code IS NOT NULL OR provider_failure_message IS NOT NULL OR provider_refund_id IS NOT NULL)))) AND NOT EXISTS(SELECT 1 FROM public.order_items WHERE order_id=oid AND event_location_id IS NOT NULL AND (fulfil_status<>'fulfilled' OR fulfilled_at IS NULL)) THEN resolution:='collected';
 ELSE RAISE EXCEPTION 'event_exception_obligation_outstanding'; END IF;
 UPDATE public.event_order_exceptions SET state='resolved',resolution_code=resolution,resolution_evidence=evidence,resolved_at=now(),resolution_note=btrim(p_note),version=version+1,updated_at=now() WHERE id=c.id;
 ELSE RAISE EXCEPTION 'event_exception_action_invalid'; END IF;
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,after_data,note) VALUES(p_actor,'event_exception.'||p_action,'event_order_exception',c.id,jsonb_build_object('version',c.version+1,'dueAt',p_due,'resolution',resolution,'evidence',evidence),p_note);
 RETURN jsonb_build_object('id',c.id,'version',c.version+1);
END; $$;
REVOKE ALL ON FUNCTION public.update_event_order_exception(uuid,uuid,integer,text,timestamptz,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.update_event_order_exception(uuid,uuid,integer,text,timestamptz,text) TO service_role;

DO $patch$ DECLARE src text; BEGIN
 src:=pg_get_functiondef('public.get_event_reservation_operations_filtered(uuid,jsonb)'::regprocedure);
 IF position('payment_unfulfillable' IN src)=0 OR position('page_rows AS' IN src)=0 THEN RAISE EXCEPTION 'event_operations_definition_drift'; END IF;
 src:=replace(src,'''all'',''payment_unfulfillable'',''refund_attention''','''all'',''payment_unfulfillable'',''refund_attention'',''pickup_overdue''');
 src:=replace(src,'e.state,e.assigned_to','e.state,e.resolution_code AS "resolutionCode",e.resolution_note AS "resolutionNote",e.order_id AS "orderId",(SELECT coalesce(jsonb_agg(jsonb_build_object(''name'',oi.product_name,''quantity'',oi.quantity,''pickupDate'',oi.pickup_date,''status'',oi.fulfil_status,''vendorName'',v.name,''pickupLabel'',oi.variant_name) ORDER BY oi.id),''[]''::jsonb) FROM public.order_items oi LEFT JOIN public.vendors v ON v.id=oi.vendor_id WHERE oi.order_id=e.order_id AND oi.event_location_id IS NOT NULL) AS "pickupItems",e.assigned_to');
 src:=replace(src,'id,version,kind,"reasonCode",state,"orderNumber"','id,version,kind,"reasonCode",state,"resolutionCode","resolutionNote","orderId","pickupItems","orderNumber"');
 EXECUTE src;
END; $patch$;
-- Discovery only: no balances, refunds, false pickup, or forfeiture.
DO $$ BEGIN PERFORM set_config('request.jwt.claim.role','service_role',true); PERFORM public.refresh_overdue_event_pickups(); END; $$;
NOTIFY pgrst,'reload schema';
