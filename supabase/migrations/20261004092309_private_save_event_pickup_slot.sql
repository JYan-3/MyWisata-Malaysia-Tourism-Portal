-- Preserve the live event pickup slot validation and ownership rules behind a narrow RPC wrapper.
ALTER FUNCTION public.save_event_pickup_slot(
  uuid, uuid, date, time without time zone, time without time zone, integer
) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.save_event_pickup_slot(
  uuid, uuid, date, time without time zone, time without time zone, integer
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.save_event_pickup_slot(
  uuid, uuid, date, time without time zone, time without time zone, integer
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.save_event_pickup_slot(
  p_registration_id uuid,
  p_slot_id uuid,
  p_slot_date date,
  p_starts_at time without time zone,
  p_ends_at time without time zone,
  p_capacity integer
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.save_event_pickup_slot(
    p_registration_id,
    p_slot_id,
    p_slot_date,
    p_starts_at,
    p_ends_at,
    p_capacity
  );
$function$;

REVOKE ALL ON FUNCTION public.save_event_pickup_slot(
  uuid, uuid, date, time without time zone, time without time zone, integer
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.save_event_pickup_slot(
  uuid, uuid, date, time without time zone, time without time zone, integer
) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
