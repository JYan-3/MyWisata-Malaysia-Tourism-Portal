-- Preserve withdrawal approval guards behind an invoker-security API.
ALTER FUNCTION public.record_admin_approval(uuid) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.record_admin_approval(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.record_admin_approval(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_admin_approval(p_withdrawal_id uuid)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.record_admin_approval(p_withdrawal_id);
$function$;

REVOKE ALL ON FUNCTION public.record_admin_approval(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_admin_approval(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
