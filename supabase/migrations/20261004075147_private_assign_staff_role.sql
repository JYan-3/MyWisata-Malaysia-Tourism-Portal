-- Keep privileged staff-role validation, assignment, and audit writes behind
-- the existing authenticated super-admin RPC.
ALTER FUNCTION public.assign_staff_role(uuid, uuid, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.assign_staff_role(uuid, uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.assign_staff_role(uuid, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.assign_staff_role(
  p_role_id uuid,
  p_user_id uuid,
  p_reason text
)
RETURNS uuid
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.assign_staff_role(
    p_role_id,
    p_user_id,
    p_reason
  );
$function$;

REVOKE ALL ON FUNCTION public.assign_staff_role(uuid, uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.assign_staff_role(uuid, uuid, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
