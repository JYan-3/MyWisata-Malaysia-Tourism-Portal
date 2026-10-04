-- Preserve the legacy admin conversion's identity check, bonus bounds, and
-- atomic pending reward writes behind its existing RPC signature.
ALTER FUNCTION public.convert_recommendation(uuid, uuid, uuid, numeric) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.convert_recommendation(uuid, uuid, uuid, numeric) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.convert_recommendation(uuid, uuid, uuid, numeric) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.convert_recommendation(
  p_recommendation_id uuid,
  p_admin_id uuid,
  p_vendor_id uuid,
  p_bonus_amount numeric DEFAULT 12.50
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  SELECT app_private.convert_recommendation(
    p_recommendation_id,
    p_admin_id,
    p_vendor_id,
    p_bonus_amount
  );
$function$;

REVOKE ALL ON FUNCTION public.convert_recommendation(uuid, uuid, uuid, numeric) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.convert_recommendation(uuid, uuid, uuid, numeric) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
