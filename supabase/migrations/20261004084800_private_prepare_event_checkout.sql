-- Preserve event reservation checkout behavior behind an invoker-security API.
ALTER FUNCTION public.prepare_event_checkout(uuid, date, uuid, integer, text, text, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.prepare_event_checkout(uuid, date, uuid, integer, text, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.prepare_event_checkout(uuid, date, uuid, integer, text, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.prepare_event_checkout(
  p_listing_id uuid,
  p_pickup_date date,
  p_slot_id uuid,
  p_quantity integer,
  p_payment_method text,
  p_idempotency_key text,
  p_request_hash text
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.prepare_event_checkout(
    p_listing_id,
    p_pickup_date,
    p_slot_id,
    p_quantity,
    p_payment_method,
    p_idempotency_key,
    p_request_hash
  );
$function$;

REVOKE ALL ON FUNCTION public.prepare_event_checkout(uuid, date, uuid, integer, text, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.prepare_event_checkout(uuid, date, uuid, integer, text, text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
