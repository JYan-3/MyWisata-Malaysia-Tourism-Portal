-- Preserve vendor withdrawal/admin removal checks and the campaign registration
-- state transition behind the existing authenticated RPC contract.
ALTER FUNCTION public.close_campaign_registration(uuid, text, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.close_campaign_registration(uuid, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.close_campaign_registration(uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.close_campaign_registration(
  p_registration_id uuid,
  p_action text,
  p_reason text
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.close_campaign_registration(
    p_registration_id,
    p_action,
    p_reason
  );
$function$;

REVOKE ALL ON FUNCTION public.close_campaign_registration(uuid, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.close_campaign_registration(uuid, text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
