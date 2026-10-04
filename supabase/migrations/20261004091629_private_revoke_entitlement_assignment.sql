-- Preserve the existing Super Admin revocation and audit logic behind a narrow RPC wrapper.
ALTER FUNCTION public.revoke_entitlement_assignment(uuid, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.revoke_entitlement_assignment(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.revoke_entitlement_assignment(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_entitlement_assignment(
  p_assignment_id uuid,
  p_reason text
)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.revoke_entitlement_assignment(
    p_assignment_id,
    p_reason
  );
$function$;

REVOKE ALL ON FUNCTION public.revoke_entitlement_assignment(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_entitlement_assignment(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
