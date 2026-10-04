-- Preserve the explicit admin capacity reconciliation entry point.
ALTER FUNCTION public.reconcile_booking_capacity() SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.reconcile_booking_capacity() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.reconcile_booking_capacity() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reconcile_booking_capacity()
RETURNS integer
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.reconcile_booking_capacity();
$function$;

REVOKE ALL ON FUNCTION public.reconcile_booking_capacity() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_booking_capacity() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
