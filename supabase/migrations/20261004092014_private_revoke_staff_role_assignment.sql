-- Preserve the current live staff assignment revocation logic behind a narrow RPC wrapper.
ALTER FUNCTION public.revoke_staff_role_assignment(uuid, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.revoke_staff_role_assignment(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.revoke_staff_role_assignment(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.revoke_staff_role_assignment(
  p_assignment_id uuid,
  p_reason text
)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.revoke_staff_role_assignment(
    p_assignment_id,
    p_reason
  );
$function$;

REVOKE ALL ON FUNCTION public.revoke_staff_role_assignment(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_staff_role_assignment(uuid, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
