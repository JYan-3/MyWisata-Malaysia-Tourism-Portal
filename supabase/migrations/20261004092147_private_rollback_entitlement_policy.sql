-- Preserve the existing entitlement rollback workflow behind an authenticated-only RPC wrapper.
ALTER FUNCTION public.rollback_entitlement_policy(uuid, integer, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.rollback_entitlement_policy(uuid, integer, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.rollback_entitlement_policy(uuid, integer, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.rollback_entitlement_policy(
  p_policy_id uuid,
  p_target_version integer,
  p_reason text
)
RETURNS uuid
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.rollback_entitlement_policy(
    p_policy_id,
    p_target_version,
    p_reason
  );
$function$;

REVOKE ALL ON FUNCTION public.rollback_entitlement_policy(uuid, integer, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.rollback_entitlement_policy(uuid, integer, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
