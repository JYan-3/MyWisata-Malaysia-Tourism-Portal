ALTER FUNCTION public.clear_phone_verification(uuid) SET SCHEMA app_private;
ALTER FUNCTION public.promote_to_profile_complete(uuid) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.clear_phone_verification(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app_private.promote_to_profile_complete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.clear_phone_verification(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.promote_to_profile_complete(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.clear_phone_verification(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  PERFORM app_private.clear_phone_verification(p_user_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.promote_to_profile_complete(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS DISTINCT FROM p_user_id AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  PERFORM app_private.promote_to_profile_complete(p_user_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.clear_phone_verification(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.promote_to_profile_complete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_phone_verification(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.promote_to_profile_complete(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
