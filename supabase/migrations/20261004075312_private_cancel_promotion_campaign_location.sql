-- Preserve campaign staff authorization and the cancellation/audit transaction
-- behind the current RPC contract used by the admin campaign editor.
ALTER FUNCTION public.cancel_promotion_campaign_location(uuid, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.cancel_promotion_campaign_location(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.cancel_promotion_campaign_location(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cancel_promotion_campaign_location(
  p_location_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.cancel_promotion_campaign_location(
    p_location_id,
    p_reason
  );
$function$;

REVOKE ALL ON FUNCTION public.cancel_promotion_campaign_location(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_promotion_campaign_location(uuid, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
