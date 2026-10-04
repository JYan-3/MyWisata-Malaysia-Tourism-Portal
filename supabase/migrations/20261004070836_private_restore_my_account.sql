ALTER FUNCTION public.restore_my_account() SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.restore_my_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.restore_my_account() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.restore_my_account()
RETURNS text
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.restore_my_account();
$function$;

REVOKE ALL ON FUNCTION public.restore_my_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_my_account() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
