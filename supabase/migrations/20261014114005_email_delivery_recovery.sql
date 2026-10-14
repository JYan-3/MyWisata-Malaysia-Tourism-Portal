-- SMTP acceptance is not idempotent. Recover only claims that never sent DATA;
-- uncertain attempts require evidence instead of automatic duplicate delivery.
ALTER TABLE public.email_outbox
 ADD COLUMN lease_token uuid,
 ADD COLUMN lease_expires_at timestamptz,
 ADD COLUMN delivery_started_at timestamptz,
 ADD COLUMN smtp_message_id text,
 ADD COLUMN delivery_state text NOT NULL DEFAULT 'ready'
   CHECK (delivery_state IN ('ready','in_flight','accepted','unknown'));
UPDATE public.email_outbox SET delivery_state='accepted' WHERE status='sent';
CREATE INDEX email_outbox_delivery_lease_idx ON public.email_outbox(lease_expires_at)
 WHERE status='sending';

CREATE FUNCTION app_private.require_email_delivery_service()
RETURNS void LANGUAGE plpgsql SET search_path=public,pg_temp AS $$ BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
END; $$;

-- Old application workers cannot bypass the guarded protocol during rollout.
CREATE OR REPLACE FUNCTION public.claim_email_outbox(p_limit integer DEFAULT 20)
RETURNS SETOF public.email_outbox LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
 PERFORM app_private.require_email_delivery_service();
 RAISE EXCEPTION 'email_delivery_protocol_required';
END; $$;

CREATE FUNCTION public.claim_email_outbox_delivery(p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_rows jsonb; v_recovered integer; v_review integer; BEGIN
 PERFORM app_private.require_email_delivery_service();
 -- Legacy or KYC-monitor-reset sending rows retain conservative ambiguity.
 UPDATE public.email_outbox SET status='failed',delivery_state='unknown',
   last_error='email_delivery_unknown',updated_at=now()
 WHERE status<>'sent' AND delivery_state IN ('ready','in_flight')
   AND ((lease_token IS NOT NULL AND lease_expires_at<=now() AND delivery_started_at IS NOT NULL)
     OR (status='sending' AND lease_token IS NULL AND updated_at<now()-interval '15 minutes')
     OR (status='failed' AND lease_token IS NULL AND attempts>0));
 UPDATE public.email_outbox SET status='failed',delivery_state='ready',
   last_error='email_claim_interrupted',next_attempt_at=now(),updated_at=now(),lease_expires_at=NULL,
   lease_token=gen_random_uuid()
 WHERE status<>'sent' AND delivery_state='ready' AND delivery_started_at IS NULL
   AND lease_token IS NOT NULL AND lease_expires_at<=now();
 GET DIAGNOSTICS v_recovered=ROW_COUNT;
 WITH candidates AS (
  SELECT id FROM public.email_outbox WHERE status IN ('pending','failed') AND delivery_state='ready'
    AND attempts<5 AND next_attempt_at<=now()
  ORDER BY created_at LIMIT greatest(1,least(coalesce(p_limit,20),100)) FOR UPDATE SKIP LOCKED
 ), claimed AS (
  UPDATE public.email_outbox e SET status='sending',attempts=e.attempts+1,lease_token=gen_random_uuid(),
    lease_expires_at=now()+interval '15 minutes',delivery_started_at=NULL,
    smtp_message_id='<outbox-'||e.id::text||'@mylawatan.my>',updated_at=now()
  FROM candidates c WHERE e.id=c.id RETURNING e.*
 ) SELECT coalesce(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) INTO v_rows FROM claimed;
 SELECT count(*) INTO v_review FROM public.email_outbox WHERE status<>'sent'
   AND (delivery_state='unknown' OR (status='failed' AND attempts>=5));
 RETURN jsonb_build_object('rows',v_rows,'recovered',v_recovered,'reviewRequired',v_review);
END; $$;

CREATE FUNCTION public.begin_email_outbox_delivery(p_id uuid,p_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_count integer; BEGIN
 PERFORM app_private.require_email_delivery_service();
 UPDATE public.email_outbox SET delivery_state='in_flight',delivery_started_at=now(),updated_at=now()
 WHERE id=p_id AND lease_token=p_token AND status='sending' AND delivery_state='ready'
   AND lease_expires_at>now();
 GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count=1;
END; $$;

CREATE FUNCTION public.finish_email_outbox_delivery(p_id uuid,p_token uuid,p_outcome text,p_message_id text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e public.email_outbox%ROWTYPE; BEGIN
 PERFORM app_private.require_email_delivery_service();
 SELECT * INTO e FROM public.email_outbox WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR p_token IS NULL OR e.lease_token IS DISTINCT FROM p_token THEN RETURN false; END IF;
 IF e.status='sent' THEN RETURN p_outcome='sent' AND e.delivery_state='accepted'; END IF;
 IF p_outcome='sent' AND e.delivery_state IN ('in_flight','unknown') AND length(btrim(coalesce(p_message_id,''))) BETWEEN 1 AND 255 THEN
  UPDATE public.email_outbox SET status='sent',delivery_state='accepted',smtp_message_id=p_message_id,
    sent_at=now(),updated_at=now(),lease_expires_at=NULL,last_error=NULL,
    payload=payload-'guestAccessToken' WHERE id=p_id;
 ELSIF p_outcome='retry' AND e.delivery_state IN ('ready','in_flight') THEN
  UPDATE public.email_outbox SET status='failed',delivery_state='ready',delivery_started_at=NULL,
    lease_expires_at=NULL,last_error='email_delivery_retryable',next_attempt_at=now()+interval '1 minute',updated_at=now()
  WHERE id=p_id;
 ELSIF p_outcome='unknown' AND e.delivery_state='in_flight' THEN
  UPDATE public.email_outbox SET status='failed',delivery_state='unknown',last_error='email_delivery_unknown',
    lease_expires_at=NULL,updated_at=now() WHERE id=p_id;
 ELSE RETURN false; END IF;
 RETURN true;
END; $$;

CREATE FUNCTION public.inspect_email_outbox_delivery()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
 PERFORM app_private.require_email_delivery_service();
 RETURN jsonb_build_object('counts',(SELECT jsonb_object_agg(state,n) FROM (
   SELECT CASE WHEN status='failed' AND attempts>=5 AND delivery_state='ready' THEN 'exhausted' ELSE delivery_state END state,count(*) n
   FROM public.email_outbox GROUP BY 1) q),
  'attention',coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM (
   SELECT id,event_type,status,delivery_state,attempts,lease_token,smtp_message_id,updated_at
   FROM public.email_outbox WHERE status<>'sent' AND (delivery_state='unknown' OR attempts>=5)
   ORDER BY updated_at LIMIT 100) q),'[]'::jsonb));
END; $$;

CREATE FUNCTION public.resolve_email_outbox_delivery(p_id uuid,p_token uuid,p_updated_at timestamptz,
 p_actor uuid,p_decision text,p_evidence text,p_message_id text DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE e public.email_outbox%ROWTYPE; BEGIN
 PERFORM app_private.require_email_delivery_service();
 IF p_actor IS NULL OR NOT coalesce(public.is_super_admin(p_actor),false) THEN RAISE EXCEPTION 'super_admin_required'; END IF;
 IF length(btrim(coalesce(p_evidence,''))) NOT BETWEEN 20 AND 500 THEN RAISE EXCEPTION 'delivery_evidence_required'; END IF;
 SELECT * INTO e FROM public.email_outbox WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR e.lease_token IS DISTINCT FROM p_token OR e.updated_at IS DISTINCT FROM p_updated_at
   OR e.status='sent' OR NOT (e.delivery_state='unknown' OR (e.status='failed' AND e.attempts>=5)) THEN
  RAISE EXCEPTION 'email_delivery_changed'; END IF;
 IF p_decision='delivered' AND length(btrim(coalesce(p_message_id,''))) BETWEEN 1 AND 255 THEN
  UPDATE public.email_outbox SET status='sent',delivery_state='accepted',smtp_message_id=p_message_id,
   sent_at=now(),updated_at=now(),last_error=NULL,lease_expires_at=NULL,lease_token=gen_random_uuid(),payload=payload-'guestAccessToken' WHERE id=p_id;
 ELSIF p_decision='retry' THEN
  UPDATE public.email_outbox SET status='failed',delivery_state='ready',attempts=0,next_attempt_at=now(),
   last_error='email_delivery_retry_authorized',updated_at=now(),lease_token=gen_random_uuid(),lease_expires_at=NULL,
   delivery_started_at=NULL,smtp_message_id=NULL WHERE id=p_id;
 ELSE RAISE EXCEPTION 'delivery_decision_invalid'; END IF;
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,after_data,note)
 VALUES(p_actor,'email_delivery.'||p_decision,'email_outbox',p_id,jsonb_build_object('previousState',e.delivery_state),btrim(p_evidence));
 RETURN true;
END; $$;

REVOKE ALL ON FUNCTION app_private.require_email_delivery_service(),public.claim_email_outbox(integer),
 public.claim_email_outbox_delivery(integer),public.begin_email_outbox_delivery(uuid,uuid),
 public.finish_email_outbox_delivery(uuid,uuid,text,text),public.inspect_email_outbox_delivery(),
 public.resolve_email_outbox_delivery(uuid,uuid,timestamptz,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION app_private.require_email_delivery_service(),public.claim_email_outbox(integer),
 public.claim_email_outbox_delivery(integer),public.begin_email_outbox_delivery(uuid,uuid),
 public.finish_email_outbox_delivery(uuid,uuid,text,text),public.inspect_email_outbox_delivery(),
 public.resolve_email_outbox_delivery(uuid,uuid,timestamptz,uuid,text,text,text) TO service_role;
