ALTER FUNCTION public.get_event_promotion_date_availability(date, date) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.get_event_promotion_date_availability(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.get_event_promotion_date_availability(date, date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_event_promotion_date_availability(p_from date, p_to date)
RETURNS TABLE(day date, occupied_count integer, available boolean)
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT * FROM app_private.get_event_promotion_date_availability(p_from, p_to);
$function$;

REVOKE ALL ON FUNCTION public.get_event_promotion_date_availability(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_event_promotion_date_availability(date, date) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
