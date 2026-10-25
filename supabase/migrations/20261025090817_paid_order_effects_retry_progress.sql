CREATE TABLE IF NOT EXISTS app_private.paid_order_effects_retry_progress (
  order_id uuid PRIMARY KEY REFERENCES public.orders(id),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'retry', 'completed', 'review_required')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_safe_error text,
  lease_token uuid,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (status = 'processing' AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status <> 'processing' AND lease_token IS NULL AND lease_expires_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS paid_order_effects_retry_due_idx
  ON app_private.paid_order_effects_retry_progress (next_attempt_at, created_at, order_id)
  WHERE status IN ('pending', 'retry', 'processing');

ALTER TABLE app_private.paid_order_effects_retry_progress ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app_private.paid_order_effects_retry_progress FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE app_private.paid_order_effects_retry_progress TO service_role;

CREATE OR REPLACE FUNCTION app_private.claim_paid_order_effects(
  p_limit integer DEFAULT 50,
  p_now timestamptz DEFAULT now()
)
RETURNS TABLE(order_id uuid, lease_token uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 50));
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH candidates AS MATERIALIZED (
    SELECT o.id, coalesce(p.attempts, 0) AS attempts
    FROM public.orders o
    LEFT JOIN app_private.paid_order_effects_retry_progress p ON p.order_id = o.id
    WHERE lower(o.status) IN ('paid', 'completed')
      AND o.paid_effects_processed_at IS NULL
      AND o.created_at >= p_now - interval '30 days'
      AND (
        p.order_id IS NULL
        OR (p.status IN ('pending', 'retry') AND p.next_attempt_at <= p_now)
        OR (p.status = 'processing' AND p.lease_expires_at <= p_now)
      )
    ORDER BY coalesce(p.next_attempt_at, o.created_at), o.created_at, o.id
    FOR UPDATE OF o SKIP LOCKED
    LIMIT v_limit
  ), claimed AS (
    INSERT INTO app_private.paid_order_effects_retry_progress AS progress
      (order_id, status, attempts, next_attempt_at, last_safe_error, lease_token, lease_expires_at, updated_at)
    SELECT candidates.id, 'processing', candidates.attempts + 1, p_now,
      NULL, gen_random_uuid(), p_now + interval '10 minutes', p_now
    FROM candidates
    ON CONFLICT ON CONSTRAINT paid_order_effects_retry_progress_pkey DO UPDATE SET
      status = 'processing',
      attempts = progress.attempts + 1,
      last_safe_error = NULL,
      lease_token = gen_random_uuid(),
      lease_expires_at = p_now + interval '10 minutes',
      updated_at = p_now
    RETURNING progress.order_id, progress.lease_token
  )
  SELECT claimed.order_id, claimed.lease_token FROM claimed;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.finish_paid_order_effects(
  p_order_id uuid,
  p_lease_token uuid,
  p_succeeded boolean,
  p_safe_error text DEFAULT NULL,
  p_now timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_attempts integer;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;

  SELECT attempts INTO v_attempts
  FROM app_private.paid_order_effects_retry_progress
  WHERE order_id = p_order_id AND status = 'processing' AND lease_token = p_lease_token
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  UPDATE app_private.paid_order_effects_retry_progress
  SET status = CASE WHEN p_succeeded THEN 'completed' WHEN v_attempts >= 8 THEN 'review_required' ELSE 'retry' END,
      next_attempt_at = CASE WHEN p_succeeded THEN p_now ELSE p_now + make_interval(secs => least(3600, 30 * (2 ^ least(v_attempts - 1, 7))::integer)) END,
      last_safe_error = CASE WHEN p_succeeded THEN NULL ELSE left(coalesce(p_safe_error, 'paid_order_effects_failed'), 80) END,
      lease_token = NULL,
      lease_expires_at = NULL,
      updated_at = p_now
  WHERE order_id = p_order_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION app_private.claim_paid_order_effects(integer, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.finish_paid_order_effects(uuid, uuid, boolean, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.claim_paid_order_effects(integer, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION app_private.finish_paid_order_effects(uuid, uuid, boolean, text, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_paid_order_effects(p_limit integer DEFAULT 50, p_now timestamptz DEFAULT now())
RETURNS TABLE(order_id uuid, lease_token uuid)
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$ SELECT * FROM app_private.claim_paid_order_effects(p_limit, p_now) $$;

CREATE OR REPLACE FUNCTION public.finish_paid_order_effects(
  p_order_id uuid, p_lease_token uuid, p_succeeded boolean,
  p_safe_error text DEFAULT NULL, p_now timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$ SELECT app_private.finish_paid_order_effects(p_order_id, p_lease_token, p_succeeded, p_safe_error, p_now) $$;

REVOKE ALL ON FUNCTION public.claim_paid_order_effects(integer, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_paid_order_effects(uuid, uuid, boolean, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_paid_order_effects(integer, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_paid_order_effects(uuid, uuid, boolean, text, timestamptz) TO service_role;
