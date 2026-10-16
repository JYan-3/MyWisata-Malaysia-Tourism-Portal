-- Expired guest rate-limit rows are maintenance data; active windows remain untouched.
CREATE INDEX IF NOT EXISTS guest_rate_limits_window_started_at_idx
  ON public.guest_rate_limits (window_started_at);

CREATE OR REPLACE FUNCTION public.purge_expired_guest_rate_limits(p_batch_size integer DEFAULT 1000)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;
  IF p_batch_size IS NULL OR p_batch_size NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'invalid_batch_size';
  END IF;

  DELETE FROM public.guest_rate_limits AS rate_limit
  USING (
    SELECT key_hash
    FROM public.guest_rate_limits
    WHERE window_started_at < now() - interval '24 hours'
    ORDER BY window_started_at
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  ) AS expired
  WHERE rate_limit.key_hash = expired.key_hash;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_guest_rate_limits(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_guest_rate_limits(integer) TO service_role;

NOTIFY pgrst, 'reload schema';
