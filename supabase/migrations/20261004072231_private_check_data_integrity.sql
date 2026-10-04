ALTER FUNCTION public.check_data_integrity() SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.check_data_integrity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.check_data_integrity() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.check_data_integrity()
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  SELECT app_private.check_data_integrity();
$function$;

REVOKE ALL ON FUNCTION public.check_data_integrity() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.check_data_integrity() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
