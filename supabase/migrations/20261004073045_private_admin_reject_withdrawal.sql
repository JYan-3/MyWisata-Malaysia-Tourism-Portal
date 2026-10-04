ALTER FUNCTION public.admin_reject_withdrawal(uuid, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.admin_reject_withdrawal(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.admin_reject_withdrawal(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_reject_withdrawal(
  p_withdrawal_id uuid,
  p_note text DEFAULT NULL::text
)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  SELECT app_private.admin_reject_withdrawal(p_withdrawal_id, p_note);
$function$;

REVOKE ALL ON FUNCTION public.admin_reject_withdrawal(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_reject_withdrawal(uuid, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
