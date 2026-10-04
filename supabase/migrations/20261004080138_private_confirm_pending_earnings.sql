-- Keep the recurring admin/service settlement job and ledger transaction
-- unchanged behind the existing RPC signature and grants.
ALTER FUNCTION public.confirm_pending_earnings() SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.confirm_pending_earnings() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.confirm_pending_earnings() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.confirm_pending_earnings()
RETURNS integer
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.confirm_pending_earnings();
$function$;

REVOKE ALL ON FUNCTION public.confirm_pending_earnings() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_pending_earnings() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
