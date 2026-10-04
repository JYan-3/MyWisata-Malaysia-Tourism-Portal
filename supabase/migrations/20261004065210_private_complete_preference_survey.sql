ALTER FUNCTION public.complete_preference_survey(uuid, text[], text, text, boolean, integer, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.complete_preference_survey(uuid, text[], text, text, boolean, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.complete_preference_survey(uuid, text[], text, text, boolean, integer, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.complete_preference_survey(
  p_user_id uuid,
  p_interests text[],
  p_budget_range text,
  p_mobility_needs text DEFAULT 'none'::text,
  p_pet_friendly boolean DEFAULT false,
  p_preferred_radius_km integer DEFAULT 20,
  p_notes text DEFAULT NULL::text
)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.complete_preference_survey(
    p_user_id,
    p_interests,
    p_budget_range,
    p_mobility_needs,
    p_pet_friendly,
    p_preferred_radius_km,
    p_notes
  );
$function$;

REVOKE ALL ON FUNCTION public.complete_preference_survey(uuid, text[], text, text, boolean, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_preference_survey(uuid, text[], text, text, boolean, integer, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
