-- Private operational records contain aggregate counts, never identity evidence.
CREATE TABLE app_private.kyc_security_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  enabled_at timestamptz NOT NULL DEFAULT now(),
  last_checked_at timestamptz
);
INSERT INTO app_private.kyc_security_state(singleton) VALUES (true);
CREATE TABLE app_private.kyc_purge_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','succeeded','failed')),
  claimed integer NOT NULL DEFAULT 0 CHECK (claimed >= 0),
  purged integer NOT NULL DEFAULT 0 CHECK (purged >= 0),
  failed integer NOT NULL DEFAULT 0 CHECK (failed >= 0),
  failure_code text CHECK (failure_code IN ('claim_failed','storage_failed','confirmation_failed','invalid_work_item','unexpected_error')),
  CHECK (purged + failed <= claimed),
  CHECK ((status = 'running') = (completed_at IS NULL)),
  CHECK (status <> 'succeeded' OR (failed = 0 AND failure_code IS NULL))
);
CREATE INDEX kyc_purge_runs_started_idx ON app_private.kyc_purge_runs(started_at DESC);
CREATE TABLE app_private.kyc_security_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('purge_failed','purge_stalled','purge_missed','access_volume','monitor_test')),
  actor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  count integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  deliveries_queued_at timestamptz
);
CREATE INDEX kyc_security_incidents_pending_idx ON app_private.kyc_security_incidents(occurred_at)
  WHERE deliveries_queued_at IS NULL;
CREATE INDEX kyc_security_incidents_actor_idx ON app_private.kyc_security_incidents(actor_id,occurred_at DESC)
  WHERE kind='access_volume';
ALTER TABLE app_private.kyc_purge_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.kyc_security_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.kyc_security_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.kyc_purge_runs, app_private.kyc_security_incidents, app_private.kyc_security_state FROM PUBLIC, anon, authenticated;
GRANT ALL ON app_private.kyc_purge_runs, app_private.kyc_security_incidents, app_private.kyc_security_state TO service_role;

-- Preserve every existing email event while extending its CHECK.
DO $$
DECLARE expression text;
BEGIN
  SELECT pg_get_expr(conbin,conrelid) INTO STRICT expression
  FROM pg_constraint WHERE conrelid='public.email_outbox'::regclass AND conname='email_outbox_event_type_check';
  ALTER TABLE public.email_outbox DROP CONSTRAINT email_outbox_event_type_check;
  EXECUTE 'ALTER TABLE public.email_outbox ADD CONSTRAINT email_outbox_event_type_check CHECK (('
    || expression || ') OR event_type=''kyc_security_alert'')';
END;
$$;

CREATE FUNCTION app_private.require_kyc_service()
RETURNS void LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF COALESCE(auth.jwt() ->> 'role','') <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
END;
$$;

-- Both queues and the delivery marker commit together. Failed fanout is retryable.
CREATE FUNCTION app_private.queue_kyc_security_incident(p_incident_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_incident app_private.kyc_security_incidents%ROWTYPE; v_recipient record; v_key text; v_count integer := 0;
BEGIN
  PERFORM app_private.require_kyc_service();
  SELECT * INTO STRICT v_incident FROM app_private.kyc_security_incidents WHERE id=p_incident_id FOR UPDATE;
  IF v_incident.deliveries_queued_at IS NOT NULL THEN RETURN 0; END IF;
  FOR v_recipient IN
    SELECT u.id,u.email FROM public.users u
    WHERE u.status='active' AND u.id IS DISTINCT FROM v_incident.actor_id
      AND public.has_staff_permission(u.id,'admin.kyc.review')
  LOOP
    v_key := 'kyc-security:' || v_incident.id::text || ':' || v_recipient.id::text;
    INSERT INTO public.notifications(user_id,type,title,body,link,category,metadata,event_key)
    VALUES (v_recipient.id,'kyc_security_alert','KYC security alert','Review the KYC security status in the protected admin area.',
      '/admin/kyc','account_security',
      jsonb_build_object('kind',v_incident.kind,'count',v_incident.count,'occurredAt',v_incident.occurred_at),v_key)
    ON CONFLICT (event_key) DO NOTHING;
    IF v_recipient.email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
       AND lower(v_recipient.email) !~ '(@demo\.|\.(local|test|invalid|example)$|@example\.(com|net|org)$)' THEN
      INSERT INTO public.email_outbox(event_key,user_id,to_email,event_type,payload,status)
      VALUES (v_key,v_recipient.id,btrim(v_recipient.email),'kyc_security_alert',
        jsonb_build_object('kind',v_incident.kind,'count',v_incident.count,'occurredAt',v_incident.occurred_at),'pending')
      ON CONFLICT (event_key) DO NOTHING;
    END IF;
    v_count := v_count + 1;
  END LOOP;
  IF v_count > 0 THEN
    UPDATE app_private.kyc_security_incidents SET deliveries_queued_at=now() WHERE id=p_incident_id;
  END IF;
  RETURN v_count;
END;
$$;

CREATE FUNCTION app_private.record_kyc_security_incident(p_key text,p_kind text,p_count integer,p_actor_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM app_private.require_kyc_service();
  IF p_key IS NULL OR length(p_key)>200 OR p_count IS NULL OR p_count<0 THEN RAISE EXCEPTION 'invalid_security_event'; END IF;
  INSERT INTO app_private.kyc_security_incidents(event_key,kind,count,actor_id)
  VALUES(p_key,p_kind,p_count,p_actor_id) ON CONFLICT (event_key) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN SELECT id INTO STRICT v_id FROM app_private.kyc_security_incidents WHERE event_key=p_key; END IF;
  PERFORM app_private.queue_kyc_security_incident(v_id);
  RETURN v_id;
END;
$$;

CREATE FUNCTION app_private.start_kyc_purge_run()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM app_private.require_kyc_service();
  INSERT INTO app_private.kyc_purge_runs DEFAULT VALUES RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE FUNCTION app_private.finish_kyc_purge_run(p_run_id uuid,p_claimed integer,p_purged integer,p_failed integer,p_failure_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_status text;
BEGIN
  PERFORM app_private.require_kyc_service();
  SELECT status INTO STRICT v_status FROM app_private.kyc_purge_runs WHERE id=p_run_id FOR UPDATE;
  IF v_status <> 'running' THEN RAISE EXCEPTION 'purge_run_already_finished'; END IF;
  IF p_claimed IS NULL OR p_purged IS NULL OR p_failed IS NULL THEN RAISE EXCEPTION 'invalid_purge_counts'; END IF;
  UPDATE app_private.kyc_purge_runs
  SET completed_at=now(), status=CASE WHEN p_failed>0 OR p_failure_code IS NOT NULL THEN 'failed' ELSE 'succeeded' END,
      claimed=p_claimed,purged=p_purged,failed=p_failed,failure_code=p_failure_code
  WHERE id=p_run_id;
  IF p_failed>0 OR p_failure_code IS NOT NULL THEN
    PERFORM app_private.record_kyc_security_incident('purge-failed:'||p_run_id::text,'purge_failed',p_failed);
  ELSE
    UPDATE app_private.kyc_security_incidents SET resolved_at=now()
    WHERE resolved_at IS NULL AND kind='purge_missed';
  END IF;
END;
$$;

CREATE FUNCTION app_private.check_kyc_security_health()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_run record; v_last app_private.kyc_purge_runs%ROWTYPE; v_enabled timestamptz; v_pending record;
BEGIN
  PERFORM app_private.require_kyc_service();
  PERFORM pg_advisory_xact_lock(hashtextextended('kyc-security-monitor',0));
  SELECT enabled_at INTO STRICT v_enabled FROM app_private.kyc_security_state WHERE singleton;
  SELECT * INTO v_last FROM app_private.kyc_purge_runs WHERE status='succeeded' ORDER BY completed_at DESC LIMIT 1;
  IF COALESCE(v_last.completed_at,v_enabled) < now()-interval '26 hours' THEN
    PERFORM app_private.record_kyc_security_incident('purge-missed:'||COALESCE(v_last.id::text,'initial'),'purge_missed',0);
  END IF;
  FOR v_run IN SELECT id FROM app_private.kyc_purge_runs WHERE status='running' AND started_at < now()-interval '15 minutes' LOOP
    PERFORM app_private.record_kyc_security_incident('purge-stalled:'||v_run.id::text,'purge_stalled',0);
  END LOOP;
  -- Recover interrupted workers only for this new security event family.
  UPDATE public.email_outbox SET status='failed',last_error='security_delivery_interrupted',
    next_attempt_at=now(),updated_at=now()
  WHERE event_type='kyc_security_alert' AND status='sending' AND attempts<5
    AND updated_at < now()-interval '15 minutes';
  UPDATE app_private.kyc_security_state SET last_checked_at=now() WHERE singleton;
  FOR v_pending IN SELECT id FROM app_private.kyc_security_incidents
    WHERE deliveries_queued_at IS NULL AND resolved_at IS NULL ORDER BY occurred_at LIMIT 100
  LOOP PERFORM app_private.queue_kyc_security_incident(v_pending.id); END LOOP;
  DELETE FROM app_private.kyc_security_incidents WHERE occurred_at < now()-interval '90 days' AND deliveries_queued_at IS NOT NULL;
  DELETE FROM app_private.kyc_purge_runs WHERE started_at < now()-interval '90 days' ;
  RETURN jsonb_build_object('checked',true);
END;
$$;

CREATE FUNCTION app_private.get_kyc_security_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM app_private.require_kyc_service();
  RETURN jsonb_build_object(
    'monitor',(SELECT jsonb_build_object('enabledAt',enabled_at,'lastCheckedAt',last_checked_at) FROM app_private.kyc_security_state WHERE singleton),
    'latestRun',(SELECT jsonb_build_object('startedAt',started_at,'completedAt',completed_at,'status',status,'claimed',claimed,'purged',purged,'failed',failed)
      FROM app_private.kyc_purge_runs ORDER BY started_at DESC LIMIT 1),
    'emailRecipients',(SELECT count(*) FROM public.users u WHERE u.status='active' AND public.has_staff_permission(u.id,'admin.kyc.review')
      AND u.email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      AND lower(u.email) !~ '(@demo\.|\.(local|test|invalid|example)$|@example\.(com|net|org)$)'),
    'pendingAlerts',(SELECT count(*) FROM app_private.kyc_security_incidents WHERE deliveries_queued_at IS NULL AND resolved_at IS NULL),
    'incidents',COALESCE((SELECT jsonb_agg(row_data) FROM (SELECT jsonb_build_object('kind',kind,'count',count,'occurredAt',occurred_at,
      'resolvedAt',resolved_at,'deliveryQueued',deliveries_queued_at IS NOT NULL) AS row_data
      FROM app_private.kyc_security_incidents ORDER BY occurred_at DESC LIMIT 10) recent),'[]'::jsonb)
  );
END;
$$;

CREATE FUNCTION app_private.check_kyc_document_access(p_actor_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_count integer; v_latest timestamptz;
BEGIN
  PERFORM app_private.require_kyc_service();
  PERFORM pg_advisory_xact_lock(hashtextextended('kyc-access:'||p_actor_id::text,0));
  SELECT count(DISTINCT entity_id) INTO v_count FROM public.audit_logs
    WHERE actor_id=p_actor_id AND action='kyc.document_viewed' AND created_at>=now()-interval '10 minutes';
  SELECT max(occurred_at) INTO v_latest FROM app_private.kyc_security_incidents WHERE actor_id=p_actor_id AND kind='access_volume';
  IF v_count >= 10 AND (v_latest IS NULL OR v_latest < now()-interval '10 minutes') THEN
    PERFORM app_private.record_kyc_security_incident('access-volume:'||p_actor_id::text||':'||gen_random_uuid()::text,'access_volume',v_count,p_actor_id);
  END IF;
END;
$$;
CREATE INDEX IF NOT EXISTS audit_logs_kyc_document_access_idx ON public.audit_logs(actor_id,created_at DESC)
  INCLUDE(entity_id) WHERE action='kyc.document_viewed';

-- Narrow public service-only wrappers; private tables are never exposed.
CREATE FUNCTION public.start_kyc_purge_run() RETURNS uuid LANGUAGE sql SECURITY INVOKER
SET search_path = public, pg_temp AS $$ SELECT app_private.start_kyc_purge_run(); $$;
CREATE FUNCTION public.finish_kyc_purge_run(p_run_id uuid,p_claimed integer,p_purged integer,p_failed integer,p_failure_code text)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path = public, pg_temp
AS $$ SELECT app_private.finish_kyc_purge_run(p_run_id,p_claimed,p_purged,p_failed,p_failure_code); $$;
CREATE FUNCTION public.check_kyc_security_health() RETURNS jsonb LANGUAGE sql SECURITY INVOKER
SET search_path = public, pg_temp AS $$ SELECT app_private.check_kyc_security_health(); $$;
CREATE FUNCTION public.get_kyc_security_status() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp AS $$ SELECT app_private.get_kyc_security_status(); $$;

REVOKE ALL ON FUNCTION app_private.require_kyc_service(),app_private.queue_kyc_security_incident(uuid),
  app_private.record_kyc_security_incident(text,text,integer,uuid),app_private.start_kyc_purge_run(),
  app_private.finish_kyc_purge_run(uuid,integer,integer,integer,text),app_private.check_kyc_security_health(),
  app_private.get_kyc_security_status(),app_private.check_kyc_document_access(uuid),
  public.start_kyc_purge_run(),public.finish_kyc_purge_run(uuid,integer,integer,integer,text),
  public.check_kyc_security_health(),public.get_kyc_security_status() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.require_kyc_service(),app_private.queue_kyc_security_incident(uuid),
  app_private.record_kyc_security_incident(text,text,integer,uuid),app_private.start_kyc_purge_run(),
  app_private.finish_kyc_purge_run(uuid,integer,integer,integer,text),app_private.check_kyc_security_health(),
  app_private.get_kyc_security_status(),app_private.check_kyc_document_access(uuid),
  public.start_kyc_purge_run(),public.finish_kyc_purge_run(uuid,integer,integer,integer,text),
  public.check_kyc_security_health(),public.get_kyc_security_status() TO service_role;
CREATE OR REPLACE FUNCTION public.get_kyc_document_view(p_submission_id uuid, p_side text, p_actor_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_path TEXT;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF NOT public.can_review_kyc(p_actor_id) THEN RAISE EXCEPTION 'admin_required'; END IF;
  IF p_side NOT IN ('front', 'back') THEN RAISE EXCEPTION 'invalid_document_side'; END IF;

  SELECT storage_path
    INTO v_path
    FROM public.kyc_submission_documents
   WHERE submission_id = p_submission_id
     AND side = p_side;
  IF NOT FOUND THEN RAISE EXCEPTION 'document_not_found'; END IF;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, after_data)
  VALUES (
    p_actor_id,
    'kyc.document_viewed',
    'kyc_submission',
    p_submission_id,
    jsonb_build_object('submission_id', p_submission_id, 'side', p_side)
  );
  PERFORM app_private.check_kyc_document_access(p_actor_id);
  RETURN v_path;
END;
$function$
;
