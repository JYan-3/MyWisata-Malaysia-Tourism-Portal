-- Inventory decrements are internal checkout work; authenticated clients cannot
-- choose arbitrary variants, quantities, or outlets through this legacy RPC.
ALTER FUNCTION public.decrement_inventory(uuid, integer, uuid) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.decrement_inventory(uuid, integer, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.decrement_inventory(uuid, integer, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.decrement_inventory(
  p_variant_id uuid,
  p_quantity integer,
  p_outlet_id uuid DEFAULT NULL::uuid
)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.decrement_inventory(
    p_variant_id,
    p_quantity,
    p_outlet_id
  );
$function$;

REVOKE ALL ON FUNCTION public.decrement_inventory(uuid, integer, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decrement_inventory(uuid, integer, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
