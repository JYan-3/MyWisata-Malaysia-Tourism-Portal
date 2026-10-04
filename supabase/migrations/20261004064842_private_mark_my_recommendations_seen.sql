ALTER FUNCTION public.mark_my_recommendations_seen() SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.mark_my_recommendations_seen() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.mark_my_recommendations_seen() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mark_my_recommendations_seen()
RETURNS timestamp with time zone
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.mark_my_recommendations_seen();
$function$;

REVOKE ALL ON FUNCTION public.mark_my_recommendations_seen() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_my_recommendations_seen() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
