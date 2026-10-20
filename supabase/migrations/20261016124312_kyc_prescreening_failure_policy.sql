-- Preserve existing roles, claim caps, token/version fences, and manual decisions.
BEGIN;
ALTER TABLE public.kyc_prescreening_jobs DROP CONSTRAINT kyc_prescreening_jobs_last_error_code_check;
ALTER TABLE public.kyc_prescreening_jobs ADD CONSTRAINT kyc_prescreening_jobs_last_error_code_check
CHECK (last_error_code IN ('ocr_unavailable','attempts_exhausted','case_closed','private_ocr_unconfigured',
 'configuration','service_auth','service_rejected','service_unavailable','network','timeout',
 'invalid_response','evidence_missing','evidence_invalid'));

CREATE OR REPLACE FUNCTION app_private.finish_kyc_prescreening_job(p_job_id uuid,p_token uuid,p_result jsonb,p_retry_seconds integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE j public.kyc_prescreening_jobs%ROWTYPE; s public.kyc_submissions%ROWTYPE; sid uuid; ocr_status text; v_outcome text; v_retry boolean; v_delay integer; v_failure text;
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
  -- Legacy callers remain retriable; new workers can stop permanent failures.
  v_retry:=coalesce(p_result->'retryable'<>'false'::jsonb,true) AND j.attempts<j.attempt_limit;
  v_failure:=CASE WHEN p_result->>'failureCode' IN ('configuration','service_auth','service_rejected',
    'service_unavailable','network','timeout','invalid_response','evidence_missing','evidence_invalid')
    THEN p_result->>'failureCode' ELSE 'ocr_unavailable' END;
  -- Existing configured base, attempt limit, and one-day safety ceiling; no new runtime budget.
  v_delay:=least(86400,p_retry_seconds * (1 << least(greatest(j.attempts-1,0),10)));
  UPDATE public.kyc_prescreening_jobs SET status=CASE WHEN v_retry THEN 'queued' ELSE 'failed' END,
   outcome='manual_review',last_error_code=v_failure,available_at=now()+make_interval(secs=>v_delay),
   lease_token=NULL,lease_expires_at=NULL,updated_at=now(),finished_at=CASE WHEN NOT v_retry THEN now() END WHERE id=j.id;
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

COMMIT;
