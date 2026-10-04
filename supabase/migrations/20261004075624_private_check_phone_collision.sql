-- Keep the phone lookup implementation private and bind authenticated lookups
-- to the current user's ID so callers cannot probe another user's identity.
ALTER FUNCTION public.check_phone_collision(text, uuid) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.check_phone_collision(text, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.check_phone_collision(text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.check_phone_collision(
  p_phone text,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  IF current_user = 'authenticated'
     AND (auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid()) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN app_private.check_phone_collision(p_phone, p_user_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.check_phone_collision(text, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.check_phone_collision(text, uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
