-- Preserve customer booking rescheduling and slot-capacity locking.
ALTER FUNCTION public.reschedule_booking(uuid, uuid) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.reschedule_booking(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.reschedule_booking(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reschedule_booking(
  p_booking_id uuid,
  p_new_slot_id uuid
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.reschedule_booking(p_booking_id, p_new_slot_id);
$function$;

REVOKE ALL ON FUNCTION public.reschedule_booking(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.reschedule_booking(uuid, uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
