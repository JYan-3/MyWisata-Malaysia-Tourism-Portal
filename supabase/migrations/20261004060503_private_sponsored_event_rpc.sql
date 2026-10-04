ALTER FUNCTION public.record_sponsored_discovery_event(uuid, uuid, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.record_sponsored_discovery_event(uuid, uuid, text) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION app_private.record_sponsored_discovery_event(uuid, uuid, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_sponsored_discovery_event(p_placement_id uuid, p_product_id uuid, p_event_type text)
RETURNS timestamp with time zone
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.record_sponsored_discovery_event(p_placement_id, p_product_id, p_event_type);
$function$;

REVOKE ALL ON FUNCTION public.record_sponsored_discovery_event(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_sponsored_discovery_event(uuid, uuid, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
