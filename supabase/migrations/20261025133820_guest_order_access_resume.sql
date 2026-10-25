ALTER TABLE public.guest_order_access_tokens
  ADD COLUMN revoked_at timestamptz;

CREATE FUNCTION public.resume_guest_order_access(p_token_hash text, p_session_hash text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_order_id uuid;
BEGIN
  IF p_token_hash !~ '^[a-f0-9]{64}$' OR p_session_hash !~ '^[a-f0-9]{64}$' THEN
    RETURN NULL;
  END IF;

  SELECT token.order_id
  INTO v_order_id
  FROM public.guest_order_access_tokens AS token
  WHERE token.token_hash = p_token_hash;

  IF v_order_id IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM 1
  FROM public.orders AS orders
  WHERE orders.id = v_order_id
    AND orders.user_id IS NULL
    AND orders.guest_subject_id IS NOT NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  PERFORM 1
  FROM public.guest_order_access_tokens AS token
  WHERE token.order_id = v_order_id
    AND token.token_hash = p_token_hash
    AND token.consumed_at IS NOT NULL
    AND token.revoked_at IS NULL
    AND token.expires_at > clock_timestamp()
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  PERFORM 1
  FROM public.guest_order_access_sessions AS session
  WHERE session.order_id = v_order_id
    AND session.token_hash = p_session_hash
    AND session.revoked_at IS NULL
    AND session.expires_at > clock_timestamp()
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN v_order_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.resume_guest_order_access(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resume_guest_order_access(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.exchange_guest_order_access(p_token_hash text, p_session_hash text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_order_id uuid;
  v_token_id uuid;
BEGIN
  IF p_token_hash !~ '^[a-f0-9]{64}$' OR p_session_hash !~ '^[a-f0-9]{64}$' THEN
    RETURN NULL;
  END IF;

  SELECT token.order_id
  INTO v_order_id
  FROM public.guest_order_access_tokens AS token
  WHERE token.token_hash = p_token_hash;

  IF v_order_id IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM 1
  FROM public.orders AS orders
  WHERE orders.id = v_order_id
    AND orders.user_id IS NULL
    AND orders.guest_subject_id IS NOT NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.guest_order_access_tokens AS token
  SET consumed_at = clock_timestamp()
  WHERE token.order_id = v_order_id
    AND token.token_hash = p_token_hash
    AND token.consumed_at IS NULL
    AND token.revoked_at IS NULL
    AND token.expires_at > clock_timestamp()
  RETURNING token.id INTO v_token_id;

  IF v_token_id IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.guest_order_access_sessions(order_id, token_hash, expires_at)
  VALUES(v_order_id, p_session_hash, clock_timestamp() + interval '24 hours');

  RETURN v_order_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.exchange_guest_order_access(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exchange_guest_order_access(text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
