-- Preserve live sponsored-placement approval previews and position governance.
ALTER FUNCTION public.transition_sponsored_discovery_placement(uuid, text, text, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.transition_sponsored_discovery_placement(uuid, text, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.transition_sponsored_discovery_placement(uuid, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.transition_sponsored_discovery_placement(
  p_placement_id uuid,
  p_action text,
  p_note text,
  p_preview_version text
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.transition_sponsored_discovery_placement(
    p_placement_id,
    p_action,
    p_note,
    p_preview_version
  );
$function$;

REVOKE ALL ON FUNCTION public.transition_sponsored_discovery_placement(uuid, text, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.transition_sponsored_discovery_placement(uuid, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
