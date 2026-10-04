ALTER FUNCTION public.resolve_profile_location_city(uuid, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.resolve_profile_location_city(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.resolve_profile_location_city(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.resolve_profile_location_city(
  p_city_id uuid,
  p_country_code text
)
RETURNS TABLE (
  id uuid,
  name text,
  country_code text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT city.id, city.name, city.country_code
    FROM app_private.resolve_profile_location_city(p_city_id, p_country_code) AS city;
$function$;

REVOKE ALL ON FUNCTION public.resolve_profile_location_city(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_profile_location_city(uuid, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
