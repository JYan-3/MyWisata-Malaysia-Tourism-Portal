ALTER FUNCTION public.search_location_cities(text, text, integer) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.search_location_cities(text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.search_location_cities(text, text, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.search_location_cities(
  p_country_code text,
  p_query text,
  p_limit integer DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  name text,
  admin1_code text,
  country_code text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  SELECT city.id, city.name, city.admin1_code, city.country_code
    FROM app_private.search_location_cities(p_country_code, p_query, p_limit) AS city;
$function$;

REVOKE ALL ON FUNCTION public.search_location_cities(text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_location_cities(text, text, integer) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
