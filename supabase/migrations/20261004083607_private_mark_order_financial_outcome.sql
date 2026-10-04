-- Preserve admin fraud reviews and provider dispute reconciliation as one RPC.
ALTER FUNCTION public.mark_order_financial_outcome(uuid, text, uuid, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.mark_order_financial_outcome(uuid, text, uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.mark_order_financial_outcome(uuid, text, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mark_order_financial_outcome(
  p_order_id uuid,
  p_status text,
  p_actor_id uuid DEFAULT NULL::uuid,
  p_provider_event_id text DEFAULT NULL::text
)
RETURNS integer
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.mark_order_financial_outcome(
    p_order_id,
    p_status,
    p_actor_id,
    p_provider_event_id
  );
$function$;

REVOKE ALL ON FUNCTION public.mark_order_financial_outcome(uuid, text, uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.mark_order_financial_outcome(uuid, text, uuid, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
