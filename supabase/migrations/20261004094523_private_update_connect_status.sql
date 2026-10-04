-- Preserve authenticated self-updates and trusted service webhook updates for Connect status.
ALTER FUNCTION public.update_connect_status(text, boolean) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.update_connect_status(text, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.update_connect_status(text, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_connect_status(
  p_connect_account_id text,
  p_payouts_enabled boolean
)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  SELECT app_private.update_connect_status(
    p_connect_account_id,
    p_payouts_enabled
  );
$function$;

REVOKE ALL ON FUNCTION public.update_connect_status(text, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_connect_status(text, boolean) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
