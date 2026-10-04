-- Keep guarded event slot deletion behind its authenticated vendor RPC.
ALTER FUNCTION public.delete_event_pickup_slot(uuid) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.delete_event_pickup_slot(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.delete_event_pickup_slot(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.delete_event_pickup_slot(
  p_slot_id uuid
)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.delete_event_pickup_slot(
    p_slot_id
  );
$function$;

REVOKE ALL ON FUNCTION public.delete_event_pickup_slot(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.delete_event_pickup_slot(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
