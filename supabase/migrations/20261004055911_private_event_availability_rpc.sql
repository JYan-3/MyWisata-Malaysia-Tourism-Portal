-- Keep the bounded public availability projection, with its privileged
-- reservation aggregation implementation outside the exposed API schema.
ALTER FUNCTION public.get_event_pickup_availability(UUID, DATE) SET SCHEMA app_private;

GRANT USAGE ON SCHEMA app_private TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.get_event_pickup_availability(UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.get_event_pickup_availability(UUID, DATE) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_event_pickup_availability(
  p_registration_id UUID,
  p_pickup_date DATE
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.get_event_pickup_availability(p_registration_id, p_pickup_date);
$function$;

REVOKE ALL ON FUNCTION public.get_event_pickup_availability(UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_pickup_availability(UUID, DATE) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
