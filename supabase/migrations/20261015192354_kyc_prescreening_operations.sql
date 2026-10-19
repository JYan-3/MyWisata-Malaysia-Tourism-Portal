-- Phase 1 only: machine assistance has no authority to approve identity.
ALTER TABLE public.kyc_submissions ADD COLUMN review_version bigint NOT NULL DEFAULT 0;
CREATE INDEX kyc_queue_status_created_id ON public.kyc_submissions(status, created_at, id);
CREATE INDEX kyc_queue_assignee_created_id ON public.kyc_submissions(assigned_to, created_at, id) WHERE status='pending';

CREATE TABLE public.kyc_review_work_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), submission_id uuid NOT NULL REFERENCES public.kyc_submissions(id),
 reviewer_id uuid NOT NULL REFERENCES public.users(id), review_version bigint NOT NULL,
 kind text NOT NULL CHECK(kind IN ('first_review','re_review')),
 started_at timestamptz NOT NULL DEFAULT clock_timestamp(), ended_at timestamptz,
 end_reason text CHECK(end_reason IN ('pause','release','decision','interrupted')),
 CHECK((ended_at IS NULL)=(end_reason IS NULL)), CHECK(ended_at IS NULL OR ended_at>=started_at)
);
CREATE UNIQUE INDEX kyc_one_open_work_session ON public.kyc_review_work_sessions(submission_id) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX kyc_one_open_reviewer_session ON public.kyc_review_work_sessions(reviewer_id) WHERE ended_at IS NULL;
CREATE INDEX kyc_work_sessions_reviewer ON public.kyc_review_work_sessions(reviewer_id, started_at);
CREATE TABLE public.kyc_prescreening_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), submission_id uuid NOT NULL REFERENCES public.kyc_submissions(id) ON DELETE CASCADE,
 evidence_revision text NOT NULL, rules_version text NOT NULL DEFAULT 'private-precheck-v1',
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','succeeded','failed','cancelled')),
 outcome text CHECK(outcome IN ('precheck_passed','manual_review','resubmit_suggested')),
 attempts integer NOT NULL DEFAULT 0, attempt_limit integer, lease_token uuid, lease_expires_at timestamptz,
 available_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
 last_error_code text CHECK(last_error_code IN ('ocr_unavailable','evidence_unavailable','attempts_exhausted','case_closed','private_ocr_unconfigured')),
 UNIQUE (submission_id, evidence_revision, rules_version)
);
CREATE INDEX kyc_prescreening_claimable ON public.kyc_prescreening_jobs(status, available_at, created_at);
ALTER TABLE public.kyc_review_work_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kyc_prescreening_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kyc_review_work_sessions, public.kyc_prescreening_jobs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.kyc_review_work_sessions, public.kyc_prescreening_jobs TO service_role;

CREATE FUNCTION app_private.require_kyc_operations_reviewer() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM app_private.require_kyc_aal2();
 IF NOT public.has_staff_permission(auth.uid(), 'admin.kyc.review') THEN RAISE EXCEPTION 'kyc_permission_required'; END IF;
END; $$;
CREATE FUNCTION app_private.require_kyc_job_service() RETURNS void
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
 IF coalesce(auth.jwt()->>'role','')<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
END; $$;

-- A submission UUID is already a new revision on resubmission. Document-row
-- identity additionally detects replacement; never use an IC hash as revision.
CREATE FUNCTION app_private.kyc_evidence_revision(p_submission uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT CASE WHEN count(*)=2 AND count(DISTINCT side)=2 AND bool_and(purge_claimed_at IS NULL)
 THEN md5(string_agg(id::text||':'||side,',' ORDER BY side,id)) END
 FROM public.kyc_submission_documents WHERE submission_id=p_submission;
$$;
CREATE FUNCTION app_private.ensure_kyc_prescreening(p_submission_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE revision text; result uuid;
BEGIN
 PERFORM app_private.require_kyc_job_service();
 PERFORM 1 FROM public.kyc_submissions WHERE id=p_submission_id AND status='pending' FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 revision:=app_private.kyc_evidence_revision(p_submission_id);
 IF revision IS NULL THEN RETURN NULL; END IF;
 INSERT INTO public.kyc_prescreening_jobs(submission_id,evidence_revision)
 VALUES(p_submission_id,revision) ON CONFLICT(submission_id,evidence_revision,rules_version) DO NOTHING;
 SELECT id INTO result FROM public.kyc_prescreening_jobs WHERE submission_id=p_submission_id
 AND evidence_revision=revision AND rules_version='private-precheck-v1';
 RETURN result;
END; $$;
CREATE FUNCTION app_private.enqueue_finalized_kyc_prescreening() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE revision text;
BEGIN
 IF OLD.status = 'draft' AND NEW.status = 'pending' THEN
  revision:=app_private.kyc_evidence_revision(NEW.id);
  IF revision IS NULL THEN RAISE EXCEPTION 'kyc_evidence_not_ready'; END IF;
  INSERT INTO public.kyc_prescreening_jobs(submission_id,evidence_revision)
  VALUES(NEW.id,revision) ON CONFLICT(submission_id,evidence_revision,rules_version) DO NOTHING;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER enqueue_finalized_kyc_prescreening AFTER UPDATE OF status ON public.kyc_submissions
 FOR EACH ROW EXECUTE FUNCTION app_private.enqueue_finalized_kyc_prescreening();

CREATE FUNCTION app_private.fence_kyc_review_assignment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to OR NEW.status IS DISTINCT FROM OLD.status THEN
  NEW.review_version:=OLD.review_version+1;
  UPDATE public.kyc_review_work_sessions SET ended_at=clock_timestamp(),
   end_reason=CASE WHEN NEW.status<>'pending' AND reviewer_id=auth.uid() THEN 'decision' ELSE 'interrupted' END
  WHERE submission_id=OLD.id AND ended_at IS NULL;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER fence_kyc_review_assignment BEFORE UPDATE OF status,assigned_to ON public.kyc_submissions
 FOR EACH ROW EXECUTE FUNCTION app_private.fence_kyc_review_assignment();

CREATE OR REPLACE FUNCTION app_private.claim_kyc_submission(p_submission_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.kyc_submissions%ROWTYPE;
BEGIN
 PERFORM app_private.require_kyc_operations_reviewer();
 SELECT * INTO s FROM public.kyc_submissions WHERE id=p_submission_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'kyc_not_found'; END IF;
 IF s.status='pending' AND s.assigned_to IS NULL AND s.user_id<>auth.uid() THEN
  UPDATE public.kyc_submissions SET assigned_to=auth.uid(),claimed_at=now() WHERE id=s.id RETURNING * INTO s;
 END IF;
 RETURN jsonb_build_object('assignedTo',s.assigned_to,'claimedAt',s.claimed_at,'reviewVersion',s.review_version,
  'isAssignedToActor',s.assigned_to=auth.uid(),
  'canDecide',s.status='pending' AND s.user_id<>auth.uid() AND (s.assigned_to=auth.uid() OR app_private.is_kyc_review_super_admin()));
END; $$;

CREATE FUNCTION app_private.manage_kyc_review_work(p_action text,p_submission_id uuid DEFAULT NULL,p_expected_version bigint DEFAULT NULL,p_session_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.kyc_submissions%ROWTYPE; work_id uuid;
BEGIN
 PERFORM app_private.require_kyc_operations_reviewer();
 IF p_action NOT IN ('next','release','start','pause') OR p_action IS NULL THEN RAISE EXCEPTION 'invalid_action'; END IF;
 -- Serialise this reviewer's navigation, not every reviewer in the platform.
 PERFORM pg_advisory_xact_lock(hashtextextended('kyc-reviewer:'||auth.uid()::text,0));
 IF p_action='next' THEN
  SELECT * INTO s FROM public.kyc_submissions WHERE status='pending' AND assigned_to=auth.uid() AND user_id<>auth.uid()
   ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN
   SELECT * INTO s FROM public.kyc_submissions WHERE status='pending' AND assigned_to IS NULL AND user_id<>auth.uid()
    ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED;
   IF FOUND THEN UPDATE public.kyc_submissions SET assigned_to=auth.uid(),claimed_at=now() WHERE id=s.id RETURNING * INTO s; END IF;
  END IF;
  RETURN jsonb_build_object('submissionId',s.id,'reviewVersion',s.review_version);
 END IF;
 SELECT * INTO s FROM public.kyc_submissions WHERE id=p_submission_id FOR UPDATE;
 IF NOT FOUND OR s.status<>'pending' OR s.user_id=auth.uid() OR
  (s.assigned_to IS DISTINCT FROM auth.uid() AND NOT (p_action='release' AND app_private.is_kyc_review_super_admin())) THEN
  RAISE EXCEPTION 'kyc_not_assigned';
 END IF;
 IF p_expected_version IS NULL OR s.review_version<>p_expected_version THEN RAISE EXCEPTION 'kyc_assignment_changed'; END IF;
 IF p_action='pause' AND p_session_id IS NULL THEN RAISE EXCEPTION 'invalid_session'; END IF;
 IF p_action='release' THEN
  UPDATE public.kyc_review_work_sessions SET ended_at=clock_timestamp(),end_reason='release'
   WHERE submission_id=s.id AND ended_at IS NULL;
  UPDATE public.kyc_submissions SET assigned_to=NULL,claimed_at=NULL WHERE id=s.id RETURNING * INTO s;
  INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,after_data)
   VALUES(auth.uid(),'kyc.release','kyc_submission',s.id,jsonb_build_object('reviewVersion',s.review_version));
 ELSIF p_action='pause' THEN
  UPDATE public.kyc_review_work_sessions SET ended_at=clock_timestamp(),end_reason='pause'
   WHERE id=p_session_id AND submission_id=s.id AND reviewer_id=auth.uid() AND ended_at IS NULL;
 ELSE
  -- A lost browser cannot contribute an unbounded duration to a new session.
  UPDATE public.kyc_review_work_sessions SET ended_at=clock_timestamp(),end_reason='interrupted'
   WHERE (submission_id=s.id OR reviewer_id=auth.uid()) AND ended_at IS NULL;
  INSERT INTO public.kyc_review_work_sessions(submission_id,reviewer_id,review_version,kind)
  VALUES(s.id,auth.uid(),s.review_version,CASE WHEN EXISTS(
   SELECT 1 FROM public.kyc_review_events e WHERE e.user_id=s.user_id AND e.submission_id<>s.id
    AND e.action='request_info' AND e.created_at<=s.created_at) THEN 're_review' ELSE 'first_review' END)
  RETURNING id INTO work_id;
 END IF;
 RETURN jsonb_build_object('submissionId',s.id,'reviewVersion',s.review_version,'sessionId',work_id,'recording',p_action='start');
END; $$;

-- Invoke the existing audited decision transaction only after a version check.
-- Remove old unfenced client entry points as part of the coordinated app release.
CREATE FUNCTION app_private.review_kyc_case(p_submission_id uuid,p_user_id uuid,p_expected_version bigint,
 p_action text,p_reason_code text DEFAULT NULL,p_reason_detail text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.kyc_submissions%ROWTYPE;
BEGIN
 PERFORM app_private.require_kyc_operations_reviewer();
 SELECT * INTO s FROM public.kyc_submissions WHERE id=p_submission_id AND user_id=p_user_id FOR UPDATE;
 IF NOT FOUND OR p_expected_version IS NULL OR s.review_version<>p_expected_version THEN RAISE EXCEPTION 'kyc_assignment_changed'; END IF;
 PERFORM app_private.admin_review_kyc(p_submission_id,p_user_id,p_action,p_reason_code,p_reason_detail);
END; $$;
REVOKE ALL ON FUNCTION public.admin_review_kyc(uuid,uuid,text,text,text),
 app_private.admin_review_kyc(uuid,uuid,text,text,text) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION app_private.get_kyc_review_queue(p_page integer,p_page_size integer,p_status text,p_assignment text,p_search text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb; n bigint; page_no integer;
BEGIN
 PERFORM app_private.require_kyc_operations_reviewer();
 IF p_page IS NULL OR p_page NOT BETWEEN 1 AND 1000000 OR p_page_size IS NULL OR p_page_size NOT IN (10,25,50)
  OR p_status IS NULL OR p_status NOT IN ('all','pending','info_requested')
  OR p_assignment IS NULL OR p_assignment NOT IN ('all','mine','unassigned')
  OR p_search IS NULL OR length(p_search)>200 THEN RAISE EXCEPTION 'invalid_queue_filters'; END IF;
 SELECT count(*) INTO n FROM public.kyc_submissions s JOIN public.users u ON u.id=s.user_id
 WHERE s.status IN ('pending','info_requested') AND (p_status='all' OR s.status=p_status)
  AND (p_assignment='all' OR (p_assignment='mine' AND s.assigned_to=auth.uid()) OR (p_assignment='unassigned' AND s.assigned_to IS NULL))
  AND (p_search='' OR position(lower(p_search) in lower(coalesce(s.legal_name_snapshot,u.full_name,'')||' '||coalesce(s.email_snapshot,u.email,'')||' '||coalesce(s.document_type,'')))>0);
 page_no:=least(p_page,greatest(1,ceil(n::numeric/p_page_size)::integer));
 WITH page_rows AS MATERIALIZED (
  SELECT s.*,coalesce(nullif(s.legal_name_snapshot,''),nullif(u.full_name,''),u.email) customer_name,
   coalesce(s.email_snapshot,u.email) customer_email,u.tier
  FROM public.kyc_submissions s JOIN public.users u ON u.id=s.user_id
  WHERE s.status IN ('pending','info_requested') AND (p_status='all' OR s.status=p_status)
   AND (p_assignment='all' OR (p_assignment='mine' AND s.assigned_to=auth.uid()) OR (p_assignment='unassigned' AND s.assigned_to IS NULL))
   AND (p_search='' OR position(lower(p_search) in lower(coalesce(s.legal_name_snapshot,u.full_name,'')||' '||coalesce(s.email_snapshot,u.email,'')||' '||coalesce(s.document_type,'')))>0)
  ORDER BY s.created_at,s.id LIMIT p_page_size OFFSET ((page_no-1)::bigint*p_page_size)
 ) SELECT jsonb_build_object(
  'submissions',coalesce(jsonb_agg(jsonb_build_object('id',id,'userId',user_id,'docType',document_type,'status',status,
   'queuePosition',queue_position,'submittedAt',created_at,'reviewedAt',reviewed_at,'reviewedBy',reviewer_id,
   'reviewReasonCode',review_reason_code,'reviewReasonDetail',NULL,'documents','[]'::jsonb,'ocr',NULL,'assignedTo',assigned_to)
   ORDER BY created_at,id),'[]'::jsonb),
  'customers',coalesce(jsonb_agg(jsonb_build_object('id',user_id,'name',customer_name,'email',customer_email,'verificationTier',tier)
   ORDER BY created_at,id),'[]'::jsonb)
 ) INTO result FROM page_rows;
 RETURN result||jsonb_build_object('page',page_no,'pageSize',p_page_size,'total',n,'totalPages',ceil(n::numeric/p_page_size),
  'counts',(SELECT jsonb_build_object('pending',count(*) FILTER(WHERE status='pending'),'infoRequested',count(*) FILTER(WHERE status='info_requested')) FROM public.kyc_submissions),
  'verifiedCount',(SELECT count(*) FROM public.users WHERE kyc_status='approved'),
  'oldestPendingAt',(SELECT min(created_at) FROM public.kyc_submissions WHERE status='pending'));
END; $$;

CREATE FUNCTION app_private.get_kyc_review_operations() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE today timestamptz; result jsonb;
BEGIN
 PERFORM app_private.require_kyc_operations_reviewer();
 today:=date_trunc('day',now() AT TIME ZONE 'Asia/Kuala_Lumpur') AT TIME ZONE 'Asia/Kuala_Lumpur';
 SELECT jsonb_build_object('submittedToday',count(*) FILTER(WHERE created_at>=today),
  'pending',count(*) FILTER(WHERE status='pending'),'infoRequested',count(*) FILTER(WHERE status='info_requested'),
  'assigned',count(*) FILTER(WHERE status='pending' AND assigned_to IS NOT NULL),
  'oldestPendingAt',min(created_at) FILTER(WHERE status='pending'),
  'waitingP95Seconds',percentile_cont(0.95) WITHIN GROUP(ORDER BY extract(epoch FROM now()-created_at)) FILTER(WHERE status='pending'))
 INTO result FROM public.kyc_submissions;
 RETURN result||jsonb_build_object(
  'decidedToday',(SELECT count(*) FROM public.kyc_review_events WHERE created_at>=today),
  'sessions',(SELECT jsonb_build_object('recorded',count(*),'closed',count(*) FILTER(WHERE end_reason IN ('pause','release','decision')),
   'incomplete',count(*) FILTER(WHERE end_reason='interrupted' OR ended_at IS NULL),
   'recordedSeconds',coalesce(sum(extract(epoch FROM ended_at-started_at)) FILTER(WHERE end_reason IN ('pause','release','decision')),0),
   'firstReviewMeanSeconds',avg(extract(epoch FROM ended_at-started_at)) FILTER(WHERE kind='first_review' AND end_reason IN ('pause','release','decision')),
   'reReviewMeanSeconds',avg(extract(epoch FROM ended_at-started_at)) FILTER(WHERE kind='re_review' AND end_reason IN ('pause','release','decision')))
   FROM public.kyc_review_work_sessions WHERE started_at>=today),
  'precheck',(SELECT jsonb_build_object('queued',count(*) FILTER(WHERE status='queued'),'processing',count(*) FILTER(WHERE status='processing'),
   'failed',count(*) FILTER(WHERE status='failed'),'completedToday',count(*) FILTER(WHERE finished_at>=today AND status='succeeded')) FROM public.kyc_prescreening_jobs),
  'effectiveReviewMinutes',NULL,'appeals',NULL,'identityFalseAcceptanceRate',NULL);
END; $$;

CREATE FUNCTION app_private.claim_kyc_prescreening_jobs(p_limit integer,p_lease_seconds integer,p_max_attempts integer,p_max_running integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE running integer; rows jsonb;
BEGIN
 PERFORM app_private.require_kyc_job_service();
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20 OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 1 AND 3600
 OR p_max_attempts IS NULL OR p_max_attempts NOT BETWEEN 1 AND 10 OR p_max_running IS NULL OR p_max_running NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'invalid_worker_budget'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('kyc-precheck-budget',0));
 UPDATE public.kyc_prescreening_jobs j SET status='cancelled',outcome='manual_review',last_error_code='case_closed',
  lease_token=NULL,lease_expires_at=NULL,finished_at=now(),updated_at=now()
 WHERE status IN ('queued','processing') AND NOT EXISTS(SELECT 1 FROM public.kyc_submissions s WHERE s.id=j.submission_id AND s.status='pending');
 UPDATE public.kyc_prescreening_jobs SET status='failed',outcome='manual_review',last_error_code='attempts_exhausted',
  lease_token=NULL,lease_expires_at=NULL,finished_at=now(),updated_at=now()
 WHERE status IN ('queued','processing') AND attempts>=p_max_attempts AND (lease_expires_at IS NULL OR lease_expires_at<=now());
 SELECT count(*) INTO running FROM public.kyc_prescreening_jobs WHERE status='processing' AND lease_expires_at>now();
 WITH candidates AS (
  SELECT id FROM public.kyc_prescreening_jobs WHERE attempts<p_max_attempts
   AND ((status='queued' AND available_at<=now()) OR (status='processing' AND lease_expires_at<=now()))
   ORDER BY available_at,created_at,id LIMIT least(p_limit,greatest(0,p_max_running-running)) FOR UPDATE SKIP LOCKED
 ), claimed AS (
  UPDATE public.kyc_prescreening_jobs j SET status='processing',attempts=j.attempts+1,attempt_limit=p_max_attempts,
   lease_token=gen_random_uuid(),lease_expires_at=now()+make_interval(secs=>p_lease_seconds),updated_at=now()
   FROM candidates c WHERE j.id=c.id RETURNING j.*
 ) SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'submissionId',c.submission_id,'evidenceRevision',c.evidence_revision,
  'leaseToken',c.lease_token,'documentType',s.document_type,'expectedDocumentNumberHmac',CASE WHEN s.ic_hash_version='hmac_sha256_v1' THEN s.ic_hash END,
  'expectedHolderName',s.legal_name_snapshot,
  'documents',(SELECT coalesce(jsonb_agg(jsonb_build_object('side',side,'path',storage_path,'mimeType',mime_type)),'[]'::jsonb)
    FROM public.kyc_submission_documents d WHERE d.submission_id=c.submission_id AND purge_claimed_at IS NULL))), '[]'::jsonb)
 INTO rows FROM claimed c JOIN public.kyc_submissions s ON s.id=c.submission_id;
 RETURN rows;
END; $$;

CREATE FUNCTION app_private.finish_kyc_prescreening_job(p_job_id uuid,p_token uuid,p_result jsonb,p_retry_seconds integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE j public.kyc_prescreening_jobs%ROWTYPE; s public.kyc_submissions%ROWTYPE; sid uuid; ocr_status text; v_outcome text;
BEGIN
 PERFORM app_private.require_kyc_job_service();
 IF p_retry_seconds IS NULL OR p_retry_seconds NOT BETWEEN 1 AND 86400 THEN RAISE EXCEPTION 'invalid_worker_budget'; END IF;
 SELECT submission_id INTO sid FROM public.kyc_prescreening_jobs WHERE id=p_job_id;
 IF sid IS NULL THEN RETURN false; END IF;
 -- Same lock order as finalize/review; stale completions have no side effects.
 SELECT * INTO s FROM public.kyc_submissions WHERE id=sid FOR UPDATE;
 SELECT * INTO j FROM public.kyc_prescreening_jobs WHERE id=p_job_id FOR UPDATE;
 IF j.status<>'processing' OR j.lease_token IS DISTINCT FROM p_token OR j.lease_expires_at<=now() THEN RETURN false; END IF;
 IF s.status<>'pending' OR app_private.kyc_evidence_revision(sid) IS DISTINCT FROM j.evidence_revision THEN
  UPDATE public.kyc_prescreening_jobs SET status='cancelled',outcome='manual_review',last_error_code='case_closed',
   lease_token=NULL,lease_expires_at=NULL,finished_at=now(),updated_at=now() WHERE id=j.id;
  RETURN false;
 END IF;
 ocr_status:=p_result->>'status';
 IF ocr_status IS NULL OR ocr_status NOT IN ('matched','mismatch','unreadable','unavailable') THEN RAISE EXCEPTION 'invalid_ocr_result'; END IF;
 IF ocr_status='unavailable' THEN
  UPDATE public.kyc_prescreening_jobs SET status=CASE WHEN attempts<attempt_limit THEN 'queued' ELSE 'failed' END,
   outcome='manual_review',last_error_code='ocr_unavailable',available_at=now()+make_interval(secs=>p_retry_seconds),
   lease_token=NULL,lease_expires_at=NULL,updated_at=now(),finished_at=CASE WHEN attempts>=attempt_limit THEN now() END WHERE id=j.id;
  RETURN true;
 END IF;
 IF (p_result->>'documentNumberHmac') IS NOT NULL AND (p_result->>'documentNumberHmac') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'invalid_ocr_result'; END IF;
 IF ocr_status='matched' AND (p_result->>'documentNumberHmac') IS DISTINCT FROM s.ic_hash THEN RAISE EXCEPTION 'invalid_ocr_match'; END IF;
 v_outcome:=CASE WHEN ocr_status='matched' AND coalesce(jsonb_array_length(p_result->'mismatchFields'),0)=0 THEN 'precheck_passed' ELSE 'manual_review' END;
 PERFORM public.record_kyc_ocr_result(sid,ocr_status,left(p_result->>'holderName',160),p_result->>'documentNumberHmac',
  right(p_result->>'documentNumberLast4',4),(p_result->>'expiryDate')::date,(p_result->>'confidence')::numeric,
  ARRAY(SELECT jsonb_array_elements_text(coalesce(p_result->'mismatchFields','[]'::jsonb))),'private-ocr-v1');
 UPDATE public.kyc_prescreening_jobs SET status='succeeded',outcome=v_outcome,last_error_code=NULL,
  lease_token=NULL,lease_expires_at=NULL,finished_at=now(),updated_at=now() WHERE id=j.id;
 RETURN true;
END; $$;

-- Public APIs are invokers; their privileged implementations live outside the
-- exposed schema. No browser grants to worker RPCs or private evidence tables.
CREATE FUNCTION public.get_kyc_review_queue(p_page integer,p_page_size integer,p_status text,p_assignment text,p_search text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT app_private.get_kyc_review_queue(p_page,p_page_size,p_status,p_assignment,p_search); $$;
CREATE FUNCTION public.manage_kyc_review_work(p_action text,p_submission_id uuid DEFAULT NULL,p_expected_version bigint DEFAULT NULL,p_session_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=public,pg_temp AS $$ SELECT app_private.manage_kyc_review_work(p_action,p_submission_id,p_expected_version,p_session_id); $$;
CREATE FUNCTION public.review_kyc_case(p_submission_id uuid,p_user_id uuid,p_expected_version bigint,p_action text,p_reason_code text DEFAULT NULL,p_reason_detail text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path=public,pg_temp AS $$ SELECT app_private.review_kyc_case(p_submission_id,p_user_id,p_expected_version,p_action,p_reason_code,p_reason_detail); $$;
CREATE FUNCTION public.get_kyc_review_operations() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$ SELECT app_private.get_kyc_review_operations(); $$;
CREATE FUNCTION public.ensure_kyc_prescreening(p_submission_id uuid) RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path=public,pg_temp AS $$ SELECT app_private.ensure_kyc_prescreening(p_submission_id); $$;
CREATE FUNCTION public.claim_kyc_prescreening_jobs(p_limit integer,p_lease_seconds integer,p_max_attempts integer,p_max_running integer)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=public,pg_temp AS $$ SELECT app_private.claim_kyc_prescreening_jobs(p_limit,p_lease_seconds,p_max_attempts,p_max_running); $$;
CREATE FUNCTION public.finish_kyc_prescreening_job(p_job_id uuid,p_token uuid,p_result jsonb,p_retry_seconds integer)
RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path=public,pg_temp AS $$ SELECT app_private.finish_kyc_prescreening_job(p_job_id,p_token,p_result,p_retry_seconds); $$;

REVOKE ALL ON FUNCTION app_private.require_kyc_operations_reviewer(),app_private.require_kyc_job_service(),
 app_private.kyc_evidence_revision(uuid),app_private.enqueue_finalized_kyc_prescreening(),app_private.fence_kyc_review_assignment()
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION app_private.require_kyc_operations_reviewer() TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.require_kyc_job_service() TO service_role;
DO $grants$ DECLARE signature text; schema_name text; BEGIN
 FOREACH schema_name IN ARRAY ARRAY['public','app_private'] LOOP
  FOREACH signature IN ARRAY ARRAY['get_kyc_review_queue(integer,integer,text,text,text)','manage_kyc_review_work(text,uuid,bigint,uuid)',
   'review_kyc_case(uuid,uuid,bigint,text,text,text)','get_kyc_review_operations()'] LOOP
   EXECUTE 'REVOKE ALL ON FUNCTION '||schema_name||'.'||signature||' FROM PUBLIC,anon,authenticated,service_role';
   EXECUTE 'GRANT EXECUTE ON FUNCTION '||schema_name||'.'||signature||' TO authenticated';
  END LOOP;
  FOREACH signature IN ARRAY ARRAY['ensure_kyc_prescreening(uuid)','claim_kyc_prescreening_jobs(integer,integer,integer,integer)',
   'finish_kyc_prescreening_job(uuid,uuid,jsonb,integer)'] LOOP
   EXECUTE 'REVOKE ALL ON FUNCTION '||schema_name||'.'||signature||' FROM PUBLIC,anon,authenticated,service_role';
   EXECUTE 'GRANT EXECUTE ON FUNCTION '||schema_name||'.'||signature||' TO service_role';
  END LOOP;
 END LOOP;
END; $grants$;
NOTIFY pgrst,'reload schema';
