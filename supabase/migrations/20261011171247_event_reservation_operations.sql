CREATE TABLE public.event_operational_job_runs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_key text NOT NULL CHECK(job_key IN ('expire_checkout_sessions','process_event_refunds')),
 started_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,
 status text NOT NULL DEFAULT 'running' CHECK(status IN ('running','succeeded','failed')),
 result_counts jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX ON public.event_operational_job_runs(job_key,started_at DESC);
ALTER TABLE public.event_operational_job_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.event_operational_job_runs FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.event_operational_job_runs TO service_role;

CREATE FUNCTION public.update_event_order_exception(p_case uuid,p_actor uuid,p_version integer,p_action text,p_due timestamptz,p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c public.event_order_exceptions%ROWTYPE; BEGIN
 IF coalesce(auth.role(),'')<>'service_role' OR p_actor IS NULL OR NOT public.is_super_admin(p_actor) THEN RAISE EXCEPTION 'super_admin_required'; END IF;
 SELECT * INTO c FROM public.event_order_exceptions WHERE id=p_case FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'event_exception_not_found'; END IF;
 IF c.version IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'event_exception_changed'; END IF;
 IF c.state<>'open' THEN RAISE EXCEPTION 'event_exception_closed'; END IF;
 IF p_action='claim' THEN
  IF c.assigned_to IS NOT NULL AND c.assigned_to<>p_actor THEN RAISE EXCEPTION 'event_exception_already_assigned'; END IF;
  IF p_due IS NULL OR p_due<=now() THEN RAISE EXCEPTION 'event_exception_due_invalid'; END IF;
  UPDATE public.event_order_exceptions SET assigned_to=p_actor,due_at=p_due,version=version+1,updated_at=now() WHERE id=c.id;
 ELSIF p_action='resolve' THEN
  IF c.assigned_to IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'event_exception_owner_required'; END IF;
  IF length(btrim(coalesce(p_note,''))) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'event_exception_note_required'; END IF;
  -- A human declaration cannot satisfy a payment obligation.
  IF c.refund_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.refunds WHERE id=c.refund_id AND status='processed') THEN RAISE EXCEPTION 'event_exception_obligation_outstanding'; END IF;
  UPDATE public.event_order_exceptions SET state='resolved',resolved_at=now(),resolution_note=btrim(p_note),version=version+1,updated_at=now() WHERE id=c.id;
 ELSE RAISE EXCEPTION 'event_exception_action_invalid'; END IF;
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,after_data,note)
 VALUES(p_actor,'event_exception.'||p_action,'event_order_exception',c.id,jsonb_build_object('version',c.version+1,'dueAt',p_due),p_note);
 RETURN jsonb_build_object('id',c.id,'version',c.version+1);
END; $$;
REVOKE ALL ON FUNCTION public.update_event_order_exception(uuid,uuid,integer,text,timestamptz,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.update_event_order_exception(uuid,uuid,integer,text,timestamptz,text) TO service_role;

CREATE FUNCTION app_private.track_event_refund_attention()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.order_items WHERE order_id=NEW.order_id AND event_location_id IS NOT NULL) THEN RETURN NEW; END IF;
 IF EXISTS(SELECT 1 FROM public.event_order_exceptions WHERE payment_id=NEW.payment_id AND kind='payment_unfulfillable') THEN
  UPDATE public.event_order_exceptions SET refund_id=NEW.id WHERE payment_id=NEW.payment_id AND kind='payment_unfulfillable';
 END IF;
 IF NEW.status='approved' OR (NEW.status='pending' AND (NEW.refund_scope='event_payment_compensation' OR EXISTS(SELECT 1 FROM public.order_items WHERE order_id=NEW.order_id AND event_location_id IS NOT NULL AND fulfil_status='cancelled'))) OR NEW.provider_failure_code IS NOT NULL OR (NEW.provider_refund_id IS NOT NULL AND NEW.status<>'processed') THEN
  IF NOT EXISTS(SELECT 1 FROM public.event_order_exceptions WHERE refund_id=NEW.id AND state='open') THEN
   INSERT INTO public.event_order_exceptions(source_key,kind,order_id,payment_id,refund_id,reason_code)
   VALUES('event-refund:'||NEW.payment_id,'refund_attention',NEW.order_id,NEW.payment_id,NEW.id,CASE WHEN NEW.provider_failure_code IS NOT NULL OR NEW.status='rejected' THEN 'refund_failed' ELSE 'refund_review_required' END)
   ON CONFLICT(source_key) DO UPDATE SET refund_id=EXCLUDED.refund_id,reason_code=EXCLUDED.reason_code,version=event_order_exceptions.version+1,updated_at=now() WHERE event_order_exceptions.state='open' AND event_order_exceptions.refund_id IS DISTINCT FROM EXCLUDED.refund_id;
  END IF;
 END IF;
 -- Completed provider evidence stays visible as resolved; pending/failed never
 -- resolve a case. Human claims and deadlines are preserved.
 IF NEW.status='processed' AND OLD.status IS DISTINCT FROM NEW.status THEN
  UPDATE public.event_order_exceptions SET state='resolved',resolved_at=now(),resolution_note='Refund completion verified',version=version+1,updated_at=now()
  WHERE payment_id=NEW.payment_id AND state='open';
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION app_private.track_event_refund_attention() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER event_refund_attention AFTER INSERT OR UPDATE OF status,provider_failure_code,auto_process ON public.refunds
FOR EACH ROW EXECUTE FUNCTION app_private.track_event_refund_attention();
-- Existing obligations enter the same queue without altering their money/status.
INSERT INTO public.event_order_exceptions(source_key,kind,order_id,payment_id,refund_id,reason_code)
SELECT DISTINCT ON(r.payment_id) 'event-refund:'||r.payment_id,'refund_attention',r.order_id,r.payment_id,r.id,'refund_review_required' FROM public.refunds r
WHERE (r.status='approved' OR (r.status='pending' AND (r.refund_scope='event_payment_compensation' OR EXISTS(SELECT 1 FROM public.order_items WHERE order_id=r.order_id AND event_location_id IS NOT NULL AND fulfil_status='cancelled'))) OR r.provider_failure_code IS NOT NULL OR r.provider_refund_id IS NOT NULL) AND r.status<>'processed'
AND EXISTS(SELECT 1 FROM public.order_items oi WHERE oi.order_id=r.order_id AND oi.event_location_id IS NOT NULL)
AND NOT EXISTS(SELECT 1 FROM public.event_order_exceptions e WHERE e.refund_id=r.id)
ORDER BY r.payment_id,r.created_at DESC
ON CONFLICT(source_key) DO NOTHING;
NOTIFY pgrst,'reload schema';
CREATE FUNCTION public.get_event_reservation_operations() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE cases jsonb; summary jsonb; runs jsonb; BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
 SELECT coalesce(jsonb_agg(row),'[]'::jsonb) INTO cases FROM (
 SELECT e.id,e.version,e.kind,e.reason_code AS "reasonCode",o.display_id AS "orderNumber",e.order_id AS "orderId",
 u.full_name AS "assignedName",e.assigned_to IS NOT NULL AS assigned,e.due_at AS "dueAt",e.created_at AS "createdAt",
 e.due_at<now() AS overdue,r.status AS "refundStatus",e.refund_id AS "refundId",
 CASE WHEN r.status='processed' THEN 0 ELSE round(coalesce(r.amount,e.verified_amount_sen/100.0,p.amount,0)*100)::bigint END AS "outstandingSen"
 FROM public.event_order_exceptions e JOIN public.orders o ON o.id=e.order_id LEFT JOIN public.users u ON u.id=e.assigned_to
 LEFT JOIN public.refunds r ON r.id=e.refund_id LEFT JOIN public.payments p ON p.id=e.payment_id
 WHERE e.state='open' ORDER BY e.due_at NULLS FIRST,e.created_at LIMIT 100) row;
 SELECT jsonb_build_object('open',count(*),'unassigned',count(*) FILTER(WHERE assigned_to IS NULL),
 'undated',count(*) FILTER(WHERE due_at IS NULL),'overdue',count(*) FILTER(WHERE due_at<now()),
 'outstandingSen',coalesce(sum(CASE WHEN r.status='processed' THEN 0 ELSE round(coalesce(r.amount,e.verified_amount_sen/100.0,p.amount,0)*100)::bigint END),0))
 INTO summary FROM public.event_order_exceptions e LEFT JOIN public.refunds r ON r.id=e.refund_id LEFT JOIN public.payments p ON p.id=e.payment_id WHERE e.state='open';
 SELECT coalesce(jsonb_agg(row),'[]'::jsonb) INTO runs FROM (
 SELECT DISTINCT ON(job_key) job_key AS "jobKey",started_at AS "startedAt",finished_at AS "finishedAt",status,result_counts AS counts
 FROM public.event_operational_job_runs ORDER BY job_key,started_at DESC) row;
 RETURN jsonb_build_object('cases',cases,'summary',summary,'runs',runs);
END; $$;
REVOKE ALL ON FUNCTION public.get_event_reservation_operations() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_reservation_operations() TO service_role;
