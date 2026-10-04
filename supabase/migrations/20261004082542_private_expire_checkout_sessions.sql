-- Expired-session finalization is invoked by cron or an authenticated admin
-- route using the server service client, never by a direct user RPC.
ALTER FUNCTION public.expire_checkout_sessions() SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.expire_checkout_sessions() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.expire_checkout_sessions() TO service_role;

CREATE OR REPLACE FUNCTION public.expire_checkout_sessions()
RETURNS integer
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.expire_checkout_sessions();
$function$;

REVOKE ALL ON FUNCTION public.expire_checkout_sessions() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.expire_checkout_sessions() TO service_role;

NOTIFY pgrst, 'reload schema';
