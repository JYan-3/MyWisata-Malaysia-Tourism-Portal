-- Preserve claimed-vendor readiness, self-dealing/idempotency checks, and the
-- recommendation reward transaction behind the current admin RPC contract.
ALTER FUNCTION public.convert_claimed_vendor_recommendation(uuid, uuid) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.convert_claimed_vendor_recommendation(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.convert_claimed_vendor_recommendation(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.convert_claimed_vendor_recommendation(
  p_vendor_id uuid,
  p_recommendation_id uuid
)
RETURNS uuid
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.convert_claimed_vendor_recommendation(
    p_vendor_id,
    p_recommendation_id
  );
$function$;

REVOKE ALL ON FUNCTION public.convert_claimed_vendor_recommendation(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.convert_claimed_vendor_recommendation(uuid, uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
