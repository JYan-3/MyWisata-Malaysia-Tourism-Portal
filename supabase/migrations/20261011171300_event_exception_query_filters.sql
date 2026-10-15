-- Read-only exception filtering; the original unfiltered RPC remains available.
CREATE FUNCTION public.get_event_reservation_operations_filtered(p_actor uuid,p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 v_search text; v_kind text; v_handling text; v_owner text; v_deadline text; v_page integer;
 v_now timestamptz:=statement_timestamp(); result jsonb;
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' OR p_actor IS NULL OR NOT public.is_super_admin(p_actor) THEN
  RAISE EXCEPTION 'super_admin_required';
 END IF;
 IF p_filters IS NULL OR jsonb_typeof(p_filters)<>'object' THEN RAISE EXCEPTION 'event_exception_filters_invalid'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(p_filters) x WHERE x.key NOT IN ('caseSearch','caseKind','caseHandling','caseOwner','caseDeadline','casePage')
   OR (x.key<>'casePage' AND jsonb_typeof(x.value)<>'string')) THEN RAISE EXCEPTION 'event_exception_filters_invalid'; END IF;
 v_search:=btrim(coalesce(p_filters->>'caseSearch',''));
 v_kind:=coalesce(p_filters->>'caseKind','all'); v_handling:=coalesce(p_filters->>'caseHandling','open');
 v_owner:=coalesce(p_filters->>'caseOwner','all'); v_deadline:=coalesce(p_filters->>'caseDeadline','all');
 IF length(v_search)>100 OR v_kind NOT IN ('all','payment_unfulfillable','refund_attention')
  OR v_handling NOT IN ('open','needs_review','awaiting_provider','refund_failed','resolved','all')
  OR v_owner NOT IN ('all','unassigned','mine','others') OR v_deadline NOT IN ('all','overdue','upcoming','undated')
  OR (p_filters ? 'casePage' AND (jsonb_typeof(p_filters->'casePage')<>'number' OR (p_filters->>'casePage')!~'^[0-9]{1,7}$')) THEN
  RAISE EXCEPTION 'event_exception_filters_invalid';
 END IF;
 v_page:=coalesce((p_filters->>'casePage')::integer,1);
 IF v_page NOT BETWEEN 1 AND 1000000 THEN RAISE EXCEPTION 'event_exception_filters_invalid'; END IF;

 WITH base AS MATERIALIZED (
  SELECT e.id,e.version,e.kind,e.reason_code AS "reasonCode",e.state,e.assigned_to,e.due_at,e.created_at,
   o.display_id AS "orderNumber",u.full_name AS "assignedName",e.assigned_to IS NOT NULL AS assigned,
   coalesce(e.assigned_to=p_actor,false) AS "isMine",e.due_at AS "dueAt",e.created_at AS "createdAt",e.resolved_at AS "resolvedAt",
   e.state='open' AND coalesce(e.due_at<v_now,false) AS overdue,r.status AS "refundStatus",e.refund_id AS "refundId",
   r.status='processed' AS "refundCompleted",
   CASE WHEN e.state='resolved' OR r.status='processed' THEN 0
    ELSE round(coalesce(r.amount,e.verified_amount_sen/100.0,p.amount,0)*100)::bigint END AS "outstandingSen",
   CASE WHEN e.state='resolved' THEN 'resolved'
    WHEN nullif(btrim(r.provider_failure_code),'') IS NOT NULL OR nullif(btrim(r.provider_failure_message),'') IS NOT NULL
      OR (r.status='rejected' AND nullif(btrim(r.provider_refund_id),'') IS NOT NULL) THEN 'refund_failed'
    WHEN r.status='approved' AND nullif(btrim(r.provider_refund_id),'') IS NOT NULL THEN 'awaiting_provider'
    ELSE 'needs_review' END AS handling
  FROM public.event_order_exceptions e JOIN public.orders o ON o.id=e.order_id
  LEFT JOIN public.users u ON u.id=e.assigned_to LEFT JOIN public.refunds r ON r.id=e.refund_id
  LEFT JOIN public.payments p ON p.id=e.payment_id
 ), matching AS MATERIALIZED (
  SELECT * FROM base b WHERE (v_search='' OR strpos(lower(coalesce(b."orderNumber",'')),lower(v_search))>0)
   AND (v_kind='all' OR b.kind=v_kind)
   AND (v_handling='all' OR (v_handling='open' AND b.state='open') OR b.handling=v_handling)
   AND (v_owner='all' OR (v_owner='unassigned' AND b.assigned_to IS NULL)
    OR (v_owner='mine' AND b.assigned_to=p_actor) OR (v_owner='others' AND b.assigned_to<>p_actor))
   AND (v_deadline='all' OR (v_deadline='overdue' AND b.overdue)
    OR (v_deadline='upcoming' AND b.state='open' AND b.due_at>=v_now) OR (v_deadline='undated' AND b.due_at IS NULL))
 ), counts AS (
  SELECT count(*) AS total,coalesce(sum("outstandingSen"),0) AS amount FROM matching
 ), paging AS (
  SELECT total,amount,least(v_page,greatest(1,ceil(total/25.0)::integer)) AS page FROM counts
 ), page_rows AS (
  SELECT id,version,kind,"reasonCode",state,"orderNumber","assignedName",assigned,"isMine","dueAt","createdAt","resolvedAt",
   overdue,"refundStatus","refundId",coalesce("refundCompleted",false) AS "refundCompleted","outstandingSen",handling
  FROM matching ORDER BY due_at NULLS FIRST,created_at,id LIMIT 25 OFFSET ((SELECT page FROM paging)-1)*25
 ), summary AS (
  SELECT jsonb_build_object('open',count(*),'unassigned',count(*) FILTER(WHERE assigned_to IS NULL),
   'undated',count(*) FILTER(WHERE due_at IS NULL),'overdue',count(*) FILTER(WHERE overdue),
   'outstandingSen',coalesce(sum("outstandingSen"),0)) AS value FROM base WHERE state='open'
 ), runs AS (
  SELECT DISTINCT ON(job_key) job_key AS "jobKey",started_at AS "startedAt",finished_at AS "finishedAt",status,result_counts AS counts
  FROM public.event_operational_job_runs ORDER BY job_key,started_at DESC,id
 )
 SELECT jsonb_build_object('cases',coalesce((SELECT jsonb_agg(row) FROM page_rows row),'[]'::jsonb),
  'summary',(SELECT value FROM summary),'total',paging.total,'matchingOutstandingSen',paging.amount,
  'page',paging.page,'pageSize',25,'runs',coalesce((SELECT jsonb_agg(row) FROM runs row),'[]'::jsonb)) INTO result FROM paging;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.get_event_reservation_operations_filtered(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_reservation_operations_filtered(uuid,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
