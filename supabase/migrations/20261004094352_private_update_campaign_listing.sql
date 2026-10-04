-- Preserve the live vendor/outlet-manager authority and campaign product checks.
ALTER FUNCTION public.update_campaign_listing(uuid, integer, boolean) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.update_campaign_listing(uuid, integer, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.update_campaign_listing(uuid, integer, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_campaign_listing(
  p_listing_id uuid,
  p_daily_quantity integer,
  p_active boolean
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.update_campaign_listing(
    p_listing_id,
    p_daily_quantity,
    p_active
  );
$function$;

REVOKE ALL ON FUNCTION public.update_campaign_listing(uuid, integer, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_campaign_listing(uuid, integer, boolean) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
