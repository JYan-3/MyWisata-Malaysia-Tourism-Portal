-- Keep policy approval's privileged row lock and audit transaction behind the
-- existing authenticated super-admin RPC contract.
ALTER FUNCTION public.approve_entitlement_policy_version(uuid, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.approve_entitlement_policy_version(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.approve_entitlement_policy_version(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_entitlement_policy_version(
  p_version_id uuid,
  p_reason text
)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.approve_entitlement_policy_version(
    p_version_id,
    p_reason
  );
$function$;

REVOKE ALL ON FUNCTION public.approve_entitlement_policy_version(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.approve_entitlement_policy_version(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
