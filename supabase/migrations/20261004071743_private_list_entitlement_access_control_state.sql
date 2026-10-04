ALTER FUNCTION public.list_entitlement_access_control_state() SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.list_entitlement_access_control_state() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.list_entitlement_access_control_state() TO authenticated;

CREATE OR REPLACE FUNCTION public.list_entitlement_access_control_state()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.list_entitlement_access_control_state();
$function$;

REVOKE ALL ON FUNCTION public.list_entitlement_access_control_state() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_entitlement_access_control_state() TO authenticated;

NOTIFY pgrst, 'reload schema';
