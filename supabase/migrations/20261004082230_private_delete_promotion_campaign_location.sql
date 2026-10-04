-- Keep guarded campaign-location deletion behind the existing admin RPC.
ALTER FUNCTION public.delete_promotion_campaign_location(uuid) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.delete_promotion_campaign_location(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.delete_promotion_campaign_location(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.delete_promotion_campaign_location(
  p_location_id uuid
)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.delete_promotion_campaign_location(
    p_location_id
  );
$function$;

REVOKE ALL ON FUNCTION public.delete_promotion_campaign_location(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.delete_promotion_campaign_location(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
