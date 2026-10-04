ALTER FUNCTION public.has_staff_permission(uuid, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.has_staff_permission(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.has_staff_permission(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.has_staff_permission(p_user_id uuid, p_permission_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN p_user_id IS NULL OR p_permission_key IS NULL THEN false
    WHEN COALESCE(auth.role(), '') = 'service_role' THEN app_private.has_staff_permission(p_user_id, p_permission_key)
    WHEN auth.uid() IS NOT NULL AND p_user_id = auth.uid() THEN app_private.has_staff_permission(p_user_id, p_permission_key)
    ELSE false
  END;
$function$;

REVOKE ALL ON FUNCTION public.has_staff_permission(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_staff_permission(uuid, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
