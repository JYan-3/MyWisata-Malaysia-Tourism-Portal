ALTER FUNCTION public.admin_get_user(uuid) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.admin_get_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.admin_get_user(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_get_user(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.admin_get_user(p_user_id);
$function$;

REVOKE ALL ON FUNCTION public.admin_get_user(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_user(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
