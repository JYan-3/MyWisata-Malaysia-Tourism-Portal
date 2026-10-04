ALTER FUNCTION public.activate_entitlement_policy_version(uuid, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.activate_entitlement_policy_version(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.activate_entitlement_policy_version(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.activate_entitlement_policy_version(p_version_id uuid, p_reason text)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.activate_entitlement_policy_version(p_version_id, p_reason);
$function$;

REVOKE ALL ON FUNCTION public.activate_entitlement_policy_version(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.activate_entitlement_policy_version(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
