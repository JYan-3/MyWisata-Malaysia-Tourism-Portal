-- Install only the runtime dependencies absent from the already-migrated project.
-- Deliberately excludes the withdrawal approver job table/functions/triggers and
-- their backfill, which are owned by later, already-applied migrations.
BEGIN;

CREATE TABLE app_private.portal_workload_slots (
  scope text NOT NULL CHECK (scope IN ('kyc_upload', 'recommendation_upload', 'trip_ai')),
  token uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (scope, token)
);
ALTER TABLE app_private.portal_workload_slots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.portal_workload_slots FROM PUBLIC, anon, authenticated;

CREATE FUNCTION app_private.claim_portal_workload(p_scope text, p_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_maximum integer;
BEGIN
  PERFORM app_private.require_kyc_job_service();
  v_maximum := CASE p_scope WHEN 'kyc_upload' THEN 1 WHEN 'recommendation_upload' THEN 2 WHEN 'trip_ai' THEN 2 END;
  IF v_maximum IS NULL OR p_token IS NULL THEN RAISE EXCEPTION 'invalid_workload'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('portal_workload:' || p_scope, 0));
  DELETE FROM app_private.portal_workload_slots WHERE scope = p_scope AND expires_at <= clock_timestamp();
  IF (SELECT count(*) FROM app_private.portal_workload_slots WHERE scope = p_scope) >= v_maximum THEN RETURN false; END IF;
  INSERT INTO app_private.portal_workload_slots(scope, token, expires_at)
  VALUES (p_scope, p_token, clock_timestamp() + interval '90 seconds');
  RETURN true;
END;
$$;

CREATE FUNCTION app_private.release_portal_workload(p_scope text, p_token uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.require_kyc_job_service();
  DELETE FROM app_private.portal_workload_slots WHERE scope = p_scope AND token = p_token;
END;
$$;

CREATE INDEX IF NOT EXISTS vendor_recommendations_owner_history
  ON public.vendor_recommendations(recommender_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS recommendation_images_staged_age
  ON public.recommendation_images(created_at, id) WHERE is_staged;
CREATE INDEX IF NOT EXISTS recommendation_images_staged_owner
  ON public.recommendation_images(owner_id) WHERE is_staged;
CREATE INDEX IF NOT EXISTS places_active_latitude
  ON public.places(lat) WHERE status = 'active';

ALTER TABLE public.recommendation_images ADD COLUMN stored_bytes integer;
UPDATE public.recommendation_images AS image
SET stored_bytes = CASE
  WHEN storage_object.metadata ->> 'size' ~ '^[0-9]{1,10}$'
    AND (storage_object.metadata ->> 'size')::bigint BETWEEN 1 AND 5242880
    THEN (storage_object.metadata ->> 'size')::integer
  ELSE 5242880
END
FROM storage.objects AS storage_object
WHERE storage_object.bucket_id = 'recommendation-images'
  AND storage_object.name = image.storage_path;
UPDATE public.recommendation_images SET stored_bytes = 5242880 WHERE stored_bytes IS NULL;
ALTER TABLE public.recommendation_images ALTER COLUMN stored_bytes SET DEFAULT 5242880;
ALTER TABLE public.recommendation_images ALTER COLUMN stored_bytes SET NOT NULL;
ALTER TABLE public.recommendation_images ADD CONSTRAINT recommendation_images_stored_bytes_check
  CHECK (stored_bytes BETWEEN 1 AND 5242880);
ALTER TABLE public.recommendation_images ADD COLUMN upload_completed boolean NOT NULL DEFAULT true;

-- Client submissions must pass through the evidence RPC and bounded server upload.
REVOKE INSERT ON public.vendor_recommendations FROM anon, authenticated;
DROP POLICY IF EXISTS recommendation_images_storage_owner_insert ON storage.objects;

CREATE FUNCTION app_private.reserve_staged_recommendation_image(
  p_owner uuid, p_id uuid, p_bytes integer, p_extension text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_path text;
BEGIN
  PERFORM app_private.require_kyc_job_service();
  IF p_owner IS NULL OR p_id IS NULL OR p_bytes IS NULL OR p_bytes NOT BETWEEN 1 AND 5242880
    OR p_extension IS NULL OR p_extension NOT IN ('jpg', 'png', 'webp') THEN
    RAISE EXCEPTION 'invalid_image';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('recommendation_images:' || p_owner::text, 0));
  IF (SELECT count(*) FROM public.recommendation_images WHERE owner_id = p_owner AND is_staged) >= 15
    OR (SELECT coalesce(sum(stored_bytes), 0) FROM public.recommendation_images WHERE owner_id = p_owner AND is_staged) + p_bytes > 78643200 THEN
    RAISE EXCEPTION 'staged_image_limit';
  END IF;
  v_path := p_owner::text || '/staged/' || p_id::text || '.' || p_extension;
  INSERT INTO public.recommendation_images(id, owner_id, storage_path, is_staged, stored_bytes, upload_completed, removed_at)
  VALUES (p_id, p_owner, v_path, true, p_bytes, false, now());
  RETURN v_path;
END;
$$;

CREATE FUNCTION app_private.complete_staged_recommendation_image(p_id uuid, p_owner uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.require_kyc_job_service();
  UPDATE public.recommendation_images AS image SET upload_completed = true, removed_at = NULL
  WHERE image.id = p_id AND image.owner_id = p_owner AND image.is_staged AND NOT image.upload_completed
    AND image.created_at > now() - interval '24 hours'
    AND EXISTS (SELECT 1 FROM storage.objects AS storage_object
      WHERE storage_object.bucket_id = 'recommendation-images' AND storage_object.name = image.storage_path);
  RETURN FOUND;
END;
$$;

CREATE FUNCTION app_private.nearest_recommendation_place(p_lat double precision, p_lng double precision)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result uuid;
BEGIN
  PERFORM app_private.require_kyc_job_service();
  IF p_lat IS NULL OR p_lng IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'invalid_location';
  END IF;
  SELECT candidate.id INTO v_result FROM (
    SELECT place.id, 6371 * 2 * asin(sqrt(least(1.0,
      power(sin(radians(place.lat::double precision - p_lat) / 2), 2)
      + cos(radians(p_lat)) * cos(radians(place.lat::double precision))
        * power(sin(radians(place.lng::double precision - p_lng) / 2), 2)))) AS km
    FROM public.places AS place
    WHERE place.status = 'active' AND place.lat IS NOT NULL AND place.lng IS NOT NULL
      AND place.lat BETWEEN p_lat - 0.05 AND p_lat + 0.05
  ) AS candidate WHERE candidate.km <= 5 ORDER BY candidate.km, candidate.id LIMIT 1;
  RETURN v_result;
END;
$$;

-- Durable tombstones make binding and cleanup mutually exclusive; callers delete
-- only paths returned by this service-only claim, then finish the batch.
CREATE FUNCTION app_private.claim_staged_recommendation_cleanup()
RETURNS TABLE(id uuid, storage_path text) LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.require_kyc_job_service();
  RETURN QUERY WITH chosen AS (
    SELECT image.id FROM public.recommendation_images AS image
    WHERE image.is_staged AND image.recommendation_id IS NULL AND image.created_at < now() - interval '24 hours'
    ORDER BY image.created_at, image.id LIMIT 50 FOR UPDATE SKIP LOCKED
  )
  UPDATE public.recommendation_images AS image SET removed_at = coalesce(image.removed_at, now())
  FROM chosen WHERE image.id = chosen.id RETURNING image.id, image.storage_path;
END;
$$;

CREATE FUNCTION app_private.finish_staged_recommendation_cleanup(p_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_affected integer;
BEGIN
  PERFORM app_private.require_kyc_job_service();
  IF coalesce(cardinality(p_ids), 0) > 50 THEN RAISE EXCEPTION 'invalid_batch'; END IF;
  DELETE FROM public.recommendation_images AS image
  WHERE image.id = ANY(p_ids) AND image.is_staged AND image.recommendation_id IS NULL AND image.removed_at IS NOT NULL;
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  RETURN v_affected;
END;
$$;

CREATE TABLE app_private.portal_dispatch_status (
  scope text PRIMARY KEY CHECK (scope IN ('kyc', 'email', 'recommendation_images')),
  last_started_at timestamptz,
  last_succeeded_at timestamptz,
  last_failed_at timestamptz
);
ALTER TABLE app_private.portal_dispatch_status ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.portal_dispatch_status FROM PUBLIC, anon, authenticated;

CREATE FUNCTION app_private.record_portal_dispatch(p_scope text, p_state text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.require_kyc_job_service();
  IF p_scope IS NULL OR p_scope NOT IN ('kyc', 'email', 'recommendation_images')
    OR p_state IS NULL OR p_state NOT IN ('started', 'succeeded', 'failed') THEN
    RAISE EXCEPTION 'invalid_dispatch';
  END IF;
  INSERT INTO app_private.portal_dispatch_status(scope, last_started_at, last_succeeded_at, last_failed_at)
  VALUES (p_scope, CASE WHEN p_state = 'started' THEN now() END,
    CASE WHEN p_state = 'succeeded' THEN now() END, CASE WHEN p_state = 'failed' THEN now() END)
  ON CONFLICT (scope) DO UPDATE SET
    last_started_at = coalesce(EXCLUDED.last_started_at, app_private.portal_dispatch_status.last_started_at),
    last_succeeded_at = coalesce(EXCLUDED.last_succeeded_at, app_private.portal_dispatch_status.last_succeeded_at),
    last_failed_at = coalesce(EXCLUDED.last_failed_at, app_private.portal_dispatch_status.last_failed_at);
END;
$$;

CREATE FUNCTION app_private.portal_queue_health()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.require_kyc_job_service();
  RETURN jsonb_build_object(
    'kyc', (SELECT jsonb_build_object('queued', count(*) FILTER (WHERE job.status = 'queued'),
      'processing', count(*) FILTER (WHERE job.status = 'processing'), 'failed', count(*) FILTER (WHERE job.status = 'failed'),
      'oldestQueuedSeconds', coalesce(extract(epoch FROM now() - min(job.created_at) FILTER (WHERE job.status = 'queued')), 0),
      'completedLastHour', count(*) FILTER (WHERE job.finished_at > now() - interval '1 hour' AND job.status = 'succeeded'),
      'expiredLeases', count(*) FILTER (WHERE job.status = 'processing' AND job.lease_expires_at <= now()))
      FROM public.kyc_prescreening_jobs AS job),
    'humanReview', (SELECT jsonb_build_object('pending', count(*) FILTER (WHERE submission.status = 'pending'),
      'completedLastHour', count(*) FILTER (WHERE submission.reviewed_at > now() - interval '1 hour' AND submission.status IN ('approved', 'rejected')),
      'oldestPendingSeconds', coalesce(extract(epoch FROM now() - min(submission.created_at) FILTER (WHERE submission.status = 'pending')), 0))
      FROM public.kyc_submissions AS submission WHERE submission.status = 'pending' OR submission.reviewed_at > now() - interval '1 hour'),
    'approverNotifications', (SELECT jsonb_build_object('pending', count(*) FILTER (WHERE job.attempts < 10),
      'reviewRequired', count(*) FILTER (WHERE job.attempts >= 10),
      'oldestPendingSeconds', coalesce(extract(epoch FROM now() - min(job.created_at)), 0))
      FROM app_private.withdrawal_approver_jobs AS job WHERE NOT job.completed),
    'email', (SELECT jsonb_build_object('pending', count(*),
      'oldestPendingSeconds', coalesce(extract(epoch FROM now() - min(outbox.created_at)), 0))
      FROM public.email_outbox AS outbox WHERE outbox.status = 'pending'),
    'dispatches', (SELECT coalesce(jsonb_object_agg(dispatch.scope,
      jsonb_build_object('lastStartedAt', dispatch.last_started_at, 'lastSucceededAt', dispatch.last_succeeded_at,
        'lastFailedAt', dispatch.last_failed_at)), '{}'::jsonb)
      FROM app_private.portal_dispatch_status AS dispatch)
  );
END;
$$;

-- Expose service-only wrappers only for the missing runtime RPCs.
CREATE FUNCTION public.claim_portal_workload(p_scope text, p_token uuid) RETURNS boolean
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$ SELECT app_private.claim_portal_workload(p_scope, p_token) $$;
CREATE FUNCTION public.release_portal_workload(p_scope text, p_token uuid) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$ SELECT app_private.release_portal_workload(p_scope, p_token) $$;
CREATE FUNCTION public.reserve_staged_recommendation_image(p_owner uuid, p_id uuid, p_bytes integer, p_extension text) RETURNS text
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$ SELECT app_private.reserve_staged_recommendation_image(p_owner, p_id, p_bytes, p_extension) $$;
CREATE FUNCTION public.complete_staged_recommendation_image(p_id uuid, p_owner uuid) RETURNS boolean
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$ SELECT app_private.complete_staged_recommendation_image(p_id, p_owner) $$;
CREATE FUNCTION public.claim_staged_recommendation_cleanup() RETURNS TABLE(id uuid, storage_path text)
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$ SELECT * FROM app_private.claim_staged_recommendation_cleanup() $$;
CREATE FUNCTION public.finish_staged_recommendation_cleanup(p_ids uuid[]) RETURNS integer
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$ SELECT app_private.finish_staged_recommendation_cleanup(p_ids) $$;
CREATE FUNCTION public.nearest_recommendation_place(p_lat double precision, p_lng double precision) RETURNS uuid
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$ SELECT app_private.nearest_recommendation_place(p_lat, p_lng) $$;
CREATE FUNCTION public.record_portal_dispatch(p_scope text, p_state text) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$ SELECT app_private.record_portal_dispatch(p_scope, p_state) $$;
CREATE FUNCTION public.portal_queue_health() RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$ SELECT app_private.portal_queue_health() $$;

REVOKE ALL ON FUNCTION app_private.claim_portal_workload(text, uuid),
  app_private.release_portal_workload(text, uuid),
  app_private.reserve_staged_recommendation_image(uuid, uuid, integer, text),
  app_private.complete_staged_recommendation_image(uuid, uuid),
  app_private.claim_staged_recommendation_cleanup(),
  app_private.finish_staged_recommendation_cleanup(uuid[]),
  app_private.nearest_recommendation_place(double precision, double precision),
  app_private.record_portal_dispatch(text, text), app_private.portal_queue_health()
FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_portal_workload(text, uuid),
  public.release_portal_workload(text, uuid),
  public.reserve_staged_recommendation_image(uuid, uuid, integer, text),
  public.complete_staged_recommendation_image(uuid, uuid),
  public.claim_staged_recommendation_cleanup(),
  public.finish_staged_recommendation_cleanup(uuid[]),
  public.nearest_recommendation_place(double precision, double precision),
  public.record_portal_dispatch(text, text), public.portal_queue_health()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.claim_portal_workload(text, uuid),
  app_private.release_portal_workload(text, uuid),
  app_private.reserve_staged_recommendation_image(uuid, uuid, integer, text),
  app_private.complete_staged_recommendation_image(uuid, uuid),
  app_private.claim_staged_recommendation_cleanup(),
  app_private.finish_staged_recommendation_cleanup(uuid[]),
  app_private.nearest_recommendation_place(double precision, double precision),
  app_private.record_portal_dispatch(text, text), app_private.portal_queue_health()
TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_portal_workload(text, uuid),
  public.release_portal_workload(text, uuid),
  public.reserve_staged_recommendation_image(uuid, uuid, integer, text),
  public.complete_staged_recommendation_image(uuid, uuid),
  public.claim_staged_recommendation_cleanup(),
  public.finish_staged_recommendation_cleanup(uuid[]),
  public.nearest_recommendation_place(double precision, double precision),
  public.record_portal_dispatch(text, text), public.portal_queue_health()
TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
