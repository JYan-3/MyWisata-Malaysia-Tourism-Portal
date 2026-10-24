-- Durable, bounded fan-out for Wallet Approver in-app and email notifications.
-- The existing cron worker drains one batch at a time; this migration adds no
-- OCR, recommendation-image, or Trip workload changes.
CREATE TABLE app_private.withdrawal_approver_jobs (
  withdrawal_id uuid NOT NULL REFERENCES public.withdrawal_requests(id),
  cycle integer NOT NULL,
  stage text NOT NULL CHECK (stage IN ('pending', 'pending_second_approval')),
  cursor_id uuid,
  completed boolean NOT NULL DEFAULT false,
  attempts integer NOT NULL DEFAULT 0,
  token uuid,
  lease_until timestamptz,
  available_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (withdrawal_id, cycle, stage)
);

ALTER TABLE app_private.withdrawal_approver_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.withdrawal_approver_jobs FROM PUBLIC, anon, authenticated;
GRANT ALL ON app_private.withdrawal_approver_jobs TO service_role;

CREATE INDEX withdrawal_approver_jobs_claim
  ON app_private.withdrawal_approver_jobs (available_at, created_at)
  WHERE NOT completed;

-- Retire the older synchronous fan-out. It sends to legacy role rows without
-- checking the current delegated approval permission.
DROP TRIGGER IF EXISTS withdrawal_approver_notification ON public.withdrawal_requests;
DROP FUNCTION IF EXISTS public.notify_withdrawal_approvers();

CREATE FUNCTION app_private.withdrawal_approver_intent() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status IN ('pending', 'pending_second_approval') THEN
    INSERT INTO app_private.withdrawal_approver_jobs (withdrawal_id, cycle, stage)
    VALUES (NEW.id, coalesce(NEW.approval_cycle, 1), NEW.status)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS withdrawal_approver_intent ON public.withdrawal_requests;
CREATE TRIGGER withdrawal_approver_intent
  AFTER INSERT OR UPDATE OF status, approval_cycle ON public.withdrawal_requests
  FOR EACH ROW EXECUTE FUNCTION app_private.withdrawal_approver_intent();

-- Pick up review work already in progress without duplicating delivered events.
INSERT INTO app_private.withdrawal_approver_jobs (withdrawal_id, cycle, stage)
SELECT id, coalesce(approval_cycle, 1), status
FROM public.withdrawal_requests
WHERE status IN ('pending', 'pending_second_approval')
ON CONFLICT DO NOTHING;

CREATE FUNCTION app_private.enqueue_withdrawal_approvers(p_id uuid, p_cycle integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.require_kyc_job_service();
  INSERT INTO app_private.withdrawal_approver_jobs (withdrawal_id, cycle, stage)
  SELECT id, coalesce(approval_cycle, 1), status
  FROM public.withdrawal_requests
  WHERE id = p_id
    AND coalesce(approval_cycle, 1) = p_cycle
    AND status IN ('pending', 'pending_second_approval')
  ON CONFLICT DO NOTHING;
END;
$$;

CREATE FUNCTION app_private.claim_withdrawal_approver_job() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  job app_private.withdrawal_approver_jobs%ROWTYPE;
  withdrawal public.withdrawal_requests%ROWTYPE;
BEGIN
  PERFORM app_private.require_kyc_job_service();
  SELECT * INTO job
  FROM app_private.withdrawal_approver_jobs
  WHERE NOT completed
    AND available_at <= now()
    AND attempts < 10
    AND (lease_until IS NULL OR lease_until <= now())
  ORDER BY available_at, created_at
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT * INTO withdrawal
  FROM public.withdrawal_requests
  WHERE id = job.withdrawal_id;

  IF withdrawal.status IS DISTINCT FROM job.stage
     OR coalesce(withdrawal.approval_cycle, 1) IS DISTINCT FROM job.cycle THEN
    UPDATE app_private.withdrawal_approver_jobs
    SET completed = true, token = NULL, lease_until = NULL
    WHERE withdrawal_id = job.withdrawal_id AND cycle = job.cycle AND stage = job.stage;
    RETURN NULL;
  END IF;

  UPDATE app_private.withdrawal_approver_jobs
  SET token = gen_random_uuid(), lease_until = now() + interval '90 seconds', attempts = attempts + 1
  WHERE withdrawal_id = job.withdrawal_id AND cycle = job.cycle AND stage = job.stage
  RETURNING * INTO job;

  RETURN jsonb_build_object(
    'withdrawalId', job.withdrawal_id,
    'cycle', job.cycle,
    'stage', job.stage,
    'cursor', job.cursor_id,
    'token', job.token,
    'customerUserId', withdrawal.user_id
  );
END;
$$;

CREATE FUNCTION app_private.withdrawal_approver_recipients(p_customer uuid, p_after uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.require_kyc_job_service();
  RETURN coalesce((
    SELECT jsonb_agg(to_jsonb(recipients))
    FROM (
      SELECT users.id, users.email, users.full_name, users.preferred_locale
      FROM public.users
      WHERE users.id <> p_customer
        AND (p_after IS NULL OR users.id > p_after)
        AND users.status = 'active'
        AND EXISTS (
          SELECT 1 FROM public.user_roles
          WHERE user_roles.user_id = users.id
            AND user_roles.vendor_id IS NULL
            AND user_roles.outlet_id IS NULL
        )
        AND public.has_staff_permission(users.id, 'admin.withdrawal.approve')
      ORDER BY users.id
      LIMIT 25
    ) recipients
  ), '[]'::jsonb);
END;
$$;

CREATE FUNCTION app_private.finish_withdrawal_approver_job(
  p_id uuid,
  p_cycle integer,
  p_stage text,
  p_token uuid,
  p_cursor uuid,
  p_complete boolean,
  p_failed boolean
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.require_kyc_job_service();
  UPDATE app_private.withdrawal_approver_jobs
  SET cursor_id = CASE WHEN p_failed THEN cursor_id ELSE p_cursor END,
      completed = CASE WHEN p_failed THEN false ELSE p_complete END,
      token = NULL,
      lease_until = NULL,
      attempts = CASE WHEN p_failed THEN attempts ELSE 0 END,
      available_at = now() + CASE WHEN p_failed THEN interval '1 minute' ELSE interval '0 seconds' END
  WHERE withdrawal_id = p_id
    AND cycle = p_cycle
    AND stage = p_stage
    AND token = p_token
    AND lease_until > now();
  RETURN FOUND;
END;
$$;

-- Keep the exposed RPCs invoker wrappers. The private implementations and
-- wrappers are callable only by the existing server-side service role.
CREATE FUNCTION public.enqueue_withdrawal_approvers(p_id uuid, p_cycle integer) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT app_private.enqueue_withdrawal_approvers(p_id, p_cycle);
$$;

CREATE FUNCTION public.claim_withdrawal_approver_job() RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT app_private.claim_withdrawal_approver_job();
$$;

CREATE FUNCTION public.withdrawal_approver_recipients(p_customer uuid, p_after uuid) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT app_private.withdrawal_approver_recipients(p_customer, p_after);
$$;

CREATE FUNCTION public.finish_withdrawal_approver_job(
  p_id uuid, p_cycle integer, p_stage text, p_token uuid, p_cursor uuid, p_complete boolean, p_failed boolean
) RETURNS boolean
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT app_private.finish_withdrawal_approver_job(p_id, p_cycle, p_stage, p_token, p_cursor, p_complete, p_failed);
$$;

REVOKE ALL ON FUNCTION app_private.withdrawal_approver_intent() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.enqueue_withdrawal_approvers(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.claim_withdrawal_approver_job() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.withdrawal_approver_recipients(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.finish_withdrawal_approver_job(uuid, integer, text, uuid, uuid, boolean, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_withdrawal_approvers(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_withdrawal_approver_job() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.withdrawal_approver_recipients(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_withdrawal_approver_job(uuid, integer, text, uuid, uuid, boolean, boolean) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION app_private.enqueue_withdrawal_approvers(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION app_private.claim_withdrawal_approver_job() TO service_role;
GRANT EXECUTE ON FUNCTION app_private.withdrawal_approver_recipients(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION app_private.finish_withdrawal_approver_job(uuid, integer, text, uuid, uuid, boolean, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_withdrawal_approvers(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_withdrawal_approver_job() TO service_role;
GRANT EXECUTE ON FUNCTION public.withdrawal_approver_recipients(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_withdrawal_approver_job(uuid, integer, text, uuid, uuid, boolean, boolean) TO service_role;

NOTIFY pgrst, 'reload schema';
