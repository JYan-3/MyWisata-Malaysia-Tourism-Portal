ALTER FUNCTION public.get_my_roles() SET SCHEMA app_private;
ALTER FUNCTION public.get_my_staff_access() SET SCHEMA app_private;
ALTER FUNCTION public.get_my_unread_recommendation_count() SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.get_my_roles() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app_private.get_my_staff_access() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app_private.get_my_unread_recommendation_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.get_my_roles() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.get_my_staff_access() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.get_my_unread_recommendation_count() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_my_roles()
RETURNS TABLE(role_name character varying)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  SELECT * FROM app_private.get_my_roles();
$function$;

CREATE OR REPLACE FUNCTION public.get_my_staff_access()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.get_my_staff_access();
$function$;

CREATE OR REPLACE FUNCTION public.get_my_unread_recommendation_count()
RETURNS integer
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.get_my_unread_recommendation_count();
$function$;

REVOKE ALL ON FUNCTION public.get_my_roles() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_staff_access() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_unread_recommendation_count() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_roles() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_staff_access() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_unread_recommendation_count() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
