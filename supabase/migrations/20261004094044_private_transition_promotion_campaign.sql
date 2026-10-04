-- Preserve the live campaign lifecycle checks and optimistic-concurrency token.
ALTER FUNCTION public.transition_promotion_campaign(uuid, text, timestamp with time zone, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.transition_promotion_campaign(uuid, text, timestamp with time zone, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.transition_promotion_campaign(uuid, text, timestamp with time zone, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.transition_promotion_campaign(
  p_campaign_id uuid,
  p_action text,
  p_expected_updated_at timestamp with time zone,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.transition_promotion_campaign(
    p_campaign_id,
    p_action,
    p_expected_updated_at,
    p_note
  );
$function$;

REVOKE ALL ON FUNCTION public.transition_promotion_campaign(uuid, text, timestamp with time zone, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.transition_promotion_campaign(uuid, text, timestamp with time zone, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
