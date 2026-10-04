-- Preserve the existing staff invitation revocation controls behind a narrow RPC wrapper.
ALTER FUNCTION public.revoke_staff_invitation(uuid, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.revoke_staff_invitation(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.revoke_staff_invitation(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.revoke_staff_invitation(
  p_invitation_id uuid,
  p_reason text
)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.revoke_staff_invitation(
    p_invitation_id,
    p_reason
  );
$function$;

REVOKE ALL ON FUNCTION public.revoke_staff_invitation(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_staff_invitation(uuid, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
