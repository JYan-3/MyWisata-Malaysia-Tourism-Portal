-- Additive operational bounds. No money, KYC decisions or history is rewritten.
CREATE TABLE app_private.portal_workload_slots (
  scope text NOT NULL CHECK (scope IN ('kyc_upload','recommendation_upload','trip_ai')),
  token uuid NOT NULL, expires_at timestamptz NOT NULL,
  PRIMARY KEY (scope, token)
);
ALTER TABLE app_private.portal_workload_slots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.portal_workload_slots FROM PUBLIC, anon, authenticated;

CREATE FUNCTION app_private.claim_portal_workload(p_scope text, p_token uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE maximum integer;
BEGIN
  PERFORM app_private.require_kyc_job_service();
  maximum := CASE p_scope WHEN 'kyc_upload' THEN 1 WHEN 'recommendation_upload' THEN 2 WHEN 'trip_ai' THEN 2 END;
  IF maximum IS NULL OR p_token IS NULL THEN RAISE EXCEPTION 'invalid_workload'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('portal_workload:' || p_scope,0));
  DELETE FROM app_private.portal_workload_slots WHERE scope=p_scope AND expires_at <= clock_timestamp();
  IF (SELECT count(*) FROM app_private.portal_workload_slots WHERE scope=p_scope) >= maximum THEN RETURN false; END IF;
  INSERT INTO app_private.portal_workload_slots VALUES (p_scope,p_token,clock_timestamp()+interval '90 seconds');
  RETURN true;
END; $$;
CREATE FUNCTION app_private.release_portal_workload(p_scope text,p_token uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.require_kyc_job_service();
  DELETE FROM app_private.portal_workload_slots WHERE scope=p_scope AND token=p_token;
END; $$;

CREATE INDEX IF NOT EXISTS vendor_recommendations_owner_history
  ON public.vendor_recommendations(recommender_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS recommendation_images_staged_age
  ON public.recommendation_images(created_at,id) WHERE is_staged;
CREATE INDEX IF NOT EXISTS recommendation_images_staged_owner
  ON public.recommendation_images(owner_id) WHERE is_staged;
CREATE INDEX IF NOT EXISTS places_active_latitude ON public.places(lat) WHERE status='active';
ALTER TABLE public.recommendation_images ADD COLUMN stored_bytes integer NOT NULL DEFAULT 5242880
  CHECK (stored_bytes BETWEEN 1 AND 5242880);
ALTER TABLE public.recommendation_images ADD COLUMN upload_completed boolean NOT NULL DEFAULT true;
-- Browser writes must use the evidence RPC / server upload admission.
REVOKE INSERT ON public.vendor_recommendations FROM anon,authenticated;
DROP POLICY IF EXISTS recommendation_images_storage_owner_insert ON storage.objects;
CREATE FUNCTION app_private.reserve_staged_recommendation_image(p_owner uuid,p_id uuid,p_bytes integer,p_extension text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE object_path text;
BEGIN
  PERFORM app_private.require_kyc_job_service();
  IF p_owner IS NULL OR p_id IS NULL OR p_bytes IS NULL OR p_bytes NOT BETWEEN 1 AND 5242880 OR p_extension IS NULL OR p_extension NOT IN ('jpg','png','webp') THEN RAISE EXCEPTION 'invalid_image'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('recommendation_images:'||p_owner::text,0));
  -- Three five-photo attempts; even incomplete uploads occupy their reservation.
  IF (SELECT count(*) FROM public.recommendation_images WHERE owner_id=p_owner AND is_staged)>=15
    OR (SELECT coalesce(sum(stored_bytes),0) FROM public.recommendation_images WHERE owner_id=p_owner AND is_staged)+p_bytes>78643200
    THEN RAISE EXCEPTION 'staged_image_limit'; END IF;
  object_path:=p_owner::text||'/staged/'||p_id::text||'.'||p_extension;
  INSERT INTO public.recommendation_images(id,owner_id,storage_path,is_staged,stored_bytes,upload_completed,removed_at)
    VALUES(p_id,p_owner,object_path,true,p_bytes,false,now());
  RETURN object_path;
END; $$;
CREATE FUNCTION app_private.complete_staged_recommendation_image(p_id uuid,p_owner uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM app_private.require_kyc_job_service();
  UPDATE public.recommendation_images i SET upload_completed=true,removed_at=NULL
    WHERE i.id=p_id AND i.owner_id=p_owner AND i.is_staged AND NOT i.upload_completed
      AND i.created_at>now()-interval '24 hours'
      AND EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id='recommendation-images' AND o.name=i.storage_path);
  RETURN FOUND;
END; $$;

-- Rank qualifying candidates before LIMIT; deterministic ties retain 5km semantics.
CREATE FUNCTION app_private.nearest_recommendation_place(p_lat double precision,p_lng double precision) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result uuid;
BEGIN
  PERFORM app_private.require_kyc_job_service();
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN RAISE EXCEPTION 'invalid_location'; END IF;
  SELECT id INTO result FROM (
    SELECT p.id, 6371 * 2 * asin(sqrt(least(1.0,
      power(sin(radians(p.lat::double precision-p_lat)/2),2)
      +cos(radians(p_lat))*cos(radians(p.lat::double precision))*power(sin(radians(p.lng::double precision-p_lng)/2),2)))) AS km
    FROM public.places p WHERE p.status='active' AND p.lat IS NOT NULL AND p.lng IS NOT NULL
      AND p.lat BETWEEN p_lat-0.05 AND p_lat+0.05
  ) candidates WHERE km<=5 ORDER BY km,id LIMIT 1;
  RETURN result;
END; $$;

-- Tombstones are a durable deletion claim. Submission excludes removed_at rows;
-- row locks make binding and cleanup mutually exclusive. Storage failures retry.
CREATE FUNCTION app_private.claim_staged_recommendation_cleanup() RETURNS TABLE(id uuid,storage_path text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.require_kyc_job_service();
  RETURN QUERY WITH chosen AS (
    SELECT i.id FROM public.recommendation_images i
    WHERE i.is_staged AND i.recommendation_id IS NULL AND i.created_at<now()-interval '24 hours'
    ORDER BY i.created_at,i.id LIMIT 50 FOR UPDATE SKIP LOCKED
  ) UPDATE public.recommendation_images i SET removed_at=coalesce(i.removed_at,now())
    FROM chosen c WHERE i.id=c.id RETURNING i.id,i.storage_path;
END; $$;
CREATE FUNCTION app_private.finish_staged_recommendation_cleanup(p_ids uuid[]) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE affected integer;
BEGIN
  PERFORM app_private.require_kyc_job_service();
  IF coalesce(cardinality(p_ids),0)>50 THEN RAISE EXCEPTION 'invalid_batch'; END IF;
  DELETE FROM public.recommendation_images WHERE id=ANY(p_ids) AND is_staged AND recommendation_id IS NULL AND removed_at IS NOT NULL;
  GET DIAGNOSTICS affected=ROW_COUNT;
  RETURN affected;
END; $$;

CREATE TABLE app_private.withdrawal_approver_jobs (
  withdrawal_id uuid NOT NULL REFERENCES public.withdrawal_requests(id), cycle integer NOT NULL,
  stage text NOT NULL CHECK(stage IN ('pending','pending_second_approval')),
  cursor_id uuid, completed boolean NOT NULL DEFAULT false, attempts integer NOT NULL DEFAULT 0,
  token uuid, lease_until timestamptz, available_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(withdrawal_id,cycle,stage)
);
ALTER TABLE app_private.withdrawal_approver_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.withdrawal_approver_jobs FROM PUBLIC,anon,authenticated;
CREATE INDEX withdrawal_approver_jobs_claim ON app_private.withdrawal_approver_jobs(available_at,created_at) WHERE NOT completed;
CREATE FUNCTION app_private.withdrawal_approver_intent() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status IN ('pending','pending_second_approval') THEN
    INSERT INTO app_private.withdrawal_approver_jobs(withdrawal_id,cycle,stage)
    VALUES (NEW.id,coalesce(NEW.approval_cycle,1),NEW.status) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER withdrawal_approver_intent AFTER INSERT OR UPDATE OF status,approval_cycle
  ON public.withdrawal_requests FOR EACH ROW EXECUTE FUNCTION app_private.withdrawal_approver_intent();

-- Preserve outstanding review work across rollout; existing event keys dedupe
-- first-stage notifications already delivered by the previous implementation.
INSERT INTO app_private.withdrawal_approver_jobs(withdrawal_id,cycle,stage)
  SELECT id,coalesce(approval_cycle,1),status FROM public.withdrawal_requests
  WHERE status IN ('pending','pending_second_approval') ON CONFLICT DO NOTHING;

CREATE FUNCTION app_private.enqueue_withdrawal_approvers(p_id uuid,p_cycle integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.require_kyc_job_service();
  INSERT INTO app_private.withdrawal_approver_jobs(withdrawal_id,cycle,stage)
    SELECT id,approval_cycle,status FROM public.withdrawal_requests WHERE id=p_id AND approval_cycle=p_cycle AND status IN ('pending','pending_second_approval')
    ON CONFLICT DO NOTHING;
END; $$;
CREATE FUNCTION app_private.claim_withdrawal_approver_job() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE j app_private.withdrawal_approver_jobs%ROWTYPE; r public.withdrawal_requests%ROWTYPE;
BEGIN
  PERFORM app_private.require_kyc_job_service();
  SELECT * INTO j FROM app_private.withdrawal_approver_jobs WHERE NOT completed AND available_at<=now()
    AND attempts<10 AND (lease_until IS NULL OR lease_until<=now()) ORDER BY available_at,created_at LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO r FROM public.withdrawal_requests WHERE id=j.withdrawal_id;
  IF r.status<>j.stage OR r.approval_cycle<>j.cycle THEN
    UPDATE app_private.withdrawal_approver_jobs SET completed=true WHERE withdrawal_id=j.withdrawal_id AND cycle=j.cycle AND stage=j.stage;
    RETURN NULL;
  END IF;
  UPDATE app_private.withdrawal_approver_jobs SET token=gen_random_uuid(),lease_until=now()+interval '90 seconds',attempts=attempts+1
    WHERE withdrawal_id=j.withdrawal_id AND cycle=j.cycle AND stage=j.stage RETURNING * INTO j;
  RETURN jsonb_build_object('withdrawalId',j.withdrawal_id,'cycle',j.cycle,'stage',j.stage,'cursor',j.cursor_id,'token',j.token,'customerUserId',r.user_id,'amountRm',r.amount);
END; $$;
CREATE FUNCTION app_private.withdrawal_approver_recipients(p_customer uuid,p_after uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.require_kyc_job_service();
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (
    SELECT u.id,u.email,u.full_name,u.preferred_locale FROM public.users u
    WHERE u.id<>p_customer AND (p_after IS NULL OR u.id>p_after) AND u.status='active'
      AND EXISTS(SELECT 1 FROM public.user_roles ur WHERE ur.user_id=u.id AND ur.vendor_id IS NULL AND ur.outlet_id IS NULL)
      AND public.has_staff_permission(u.id,'admin.withdrawal.approve')
    ORDER BY u.id LIMIT 25
  ) x),'[]'::jsonb);
END; $$;
CREATE FUNCTION app_private.finish_withdrawal_approver_job(p_id uuid,p_cycle integer,p_stage text,p_token uuid,p_cursor uuid,p_complete boolean,p_failed boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.require_kyc_job_service();
  UPDATE app_private.withdrawal_approver_jobs
    SET cursor_id=CASE WHEN p_failed THEN cursor_id ELSE p_cursor END,
      completed=CASE WHEN p_failed THEN false ELSE p_complete END,token=NULL,lease_until=NULL,
      attempts=CASE WHEN p_failed THEN attempts ELSE 0 END,
      available_at=now()+CASE WHEN p_failed THEN interval '1 minute' ELSE interval '0 seconds' END
    WHERE withdrawal_id=p_id AND cycle=p_cycle AND stage=p_stage AND token=p_token AND lease_until>now();
  RETURN FOUND;
END; $$;

CREATE TABLE app_private.portal_dispatch_status (
  scope text PRIMARY KEY CHECK(scope IN ('kyc','email','recommendation_images')),
  last_started_at timestamptz,last_succeeded_at timestamptz,last_failed_at timestamptz
);
ALTER TABLE app_private.portal_dispatch_status ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.portal_dispatch_status FROM PUBLIC,anon,authenticated;
CREATE FUNCTION app_private.record_portal_dispatch(p_scope text,p_state text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM app_private.require_kyc_job_service();
  IF p_scope IS NULL OR p_scope NOT IN ('kyc','email','recommendation_images') OR p_state IS NULL OR p_state NOT IN ('started','succeeded','failed') THEN RAISE EXCEPTION 'invalid_dispatch'; END IF;
  INSERT INTO app_private.portal_dispatch_status(scope,last_started_at,last_succeeded_at,last_failed_at)
    VALUES(p_scope,CASE WHEN p_state='started' THEN now() END,CASE WHEN p_state='succeeded' THEN now() END,CASE WHEN p_state='failed' THEN now() END)
    ON CONFLICT(scope) DO UPDATE SET
      last_started_at=coalesce(excluded.last_started_at,portal_dispatch_status.last_started_at),
      last_succeeded_at=coalesce(excluded.last_succeeded_at,portal_dispatch_status.last_succeeded_at),
      last_failed_at=coalesce(excluded.last_failed_at,portal_dispatch_status.last_failed_at);
END; $$;

CREATE FUNCTION app_private.portal_queue_health() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.require_kyc_job_service();
  RETURN jsonb_build_object(
    'kyc', (SELECT jsonb_build_object('queued',count(*) FILTER(WHERE status='queued'),
      'processing',count(*) FILTER(WHERE status='processing'),'failed',count(*) FILTER(WHERE status='failed'),
      'oldestQueuedSeconds',coalesce(extract(epoch FROM now()-min(created_at) FILTER(WHERE status='queued')),0),
      'completedLastHour',count(*) FILTER(WHERE finished_at>now()-interval '1 hour' AND status='succeeded'),
      'expiredLeases',count(*) FILTER(WHERE status='processing' AND lease_expires_at<=now())) FROM public.kyc_prescreening_jobs),
    'humanReview',(SELECT jsonb_build_object('pending',count(*) FILTER(WHERE status='pending'),'completedLastHour',count(*) FILTER(WHERE reviewed_at>now()-interval '1 hour' AND status IN ('approved','rejected')),'oldestPendingSeconds',coalesce(extract(epoch FROM now()-min(created_at) FILTER(WHERE status='pending')),0)) FROM public.kyc_submissions WHERE status='pending' OR reviewed_at>now()-interval '1 hour'),
    'approverNotifications',(SELECT jsonb_build_object('pending',count(*) FILTER(WHERE attempts<10),'reviewRequired',count(*) FILTER(WHERE attempts>=10),'oldestPendingSeconds',coalesce(extract(epoch FROM now()-min(created_at)),0)) FROM app_private.withdrawal_approver_jobs WHERE NOT completed),
    'email',(SELECT jsonb_build_object('pending',count(*),'oldestPendingSeconds',coalesce(extract(epoch FROM now()-min(created_at)),0)) FROM public.email_outbox WHERE status='pending'),
    'dispatches',(SELECT coalesce(jsonb_object_agg(scope,jsonb_build_object('lastStartedAt',last_started_at,'lastSucceededAt',last_succeeded_at,'lastFailedAt',last_failed_at)),'{}'::jsonb) FROM app_private.portal_dispatch_status));
END; $$;

-- Narrow invoker wrappers; only the server service can call these operational RPCs.
DO $$ DECLARE f record; args text;
BEGIN
  FOR f IN SELECT p.oid,p.proname,pg_get_function_arguments(p.oid) AS declaration,
    pg_get_function_identity_arguments(p.oid) AS identity,pg_get_function_result(p.oid) AS result,p.proargnames
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='app_private' AND p.proname IN (
      'claim_portal_workload','release_portal_workload','nearest_recommendation_place',
      'reserve_staged_recommendation_image','complete_staged_recommendation_image',
      'claim_staged_recommendation_cleanup','finish_staged_recommendation_cleanup',
      'enqueue_withdrawal_approvers','claim_withdrawal_approver_job','withdrawal_approver_recipients',
      'finish_withdrawal_approver_job','portal_queue_health','record_portal_dispatch')
  LOOP
    SELECT coalesce(string_agg(format('$%s',i),','),'') INTO args FROM generate_series(1,(SELECT pronargs FROM pg_proc WHERE oid=f.oid)) i;
    EXECUTE format('CREATE FUNCTION public.%I(%s) RETURNS %s LANGUAGE sql SECURITY INVOKER SET search_path='''' AS %L',
      f.proname,f.declaration,f.result,format('SELECT * FROM app_private.%I(%s)',f.proname,args));
    EXECUTE format('REVOKE ALL ON FUNCTION app_private.%I(%s) FROM PUBLIC,anon,authenticated',f.proname,f.identity);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC,anon,authenticated',f.proname,f.identity);
    EXECUTE format('GRANT EXECUTE ON FUNCTION app_private.%I(%s),public.%I(%s) TO service_role',f.proname,f.identity,f.proname,f.identity);
  END LOOP;
END; $$;
REVOKE ALL ON FUNCTION app_private.withdrawal_approver_intent() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
