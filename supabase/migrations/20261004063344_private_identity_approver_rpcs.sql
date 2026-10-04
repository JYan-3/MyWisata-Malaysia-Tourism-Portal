ALTER FUNCTION public.is_active_global_staff_super_admin(uuid) SET SCHEMA app_private;
ALTER FUNCTION public.is_approver(uuid) SET SCHEMA app_private;
ALTER FUNCTION public.resolve_user_capability(uuid, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.is_active_global_staff_super_admin(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app_private.is_approver(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app_private.resolve_user_capability(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.is_active_global_staff_super_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.is_approver(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.resolve_user_capability(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_active_global_staff_super_admin(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN COALESCE(auth.role(), '') = 'service_role' THEN app_private.is_active_global_staff_super_admin(p_user_id)
    WHEN auth.role() = 'authenticated' AND p_user_id IS NOT DISTINCT FROM auth.uid() THEN app_private.is_active_global_staff_super_admin(p_user_id)
    ELSE false
  END;
$function$;

CREATE OR REPLACE FUNCTION public.is_approver(uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN COALESCE(auth.role(), '') = 'service_role' THEN app_private.is_approver(uid)
    WHEN auth.role() = 'authenticated' AND uid IS NOT DISTINCT FROM auth.uid() THEN app_private.is_approver(uid)
    ELSE false
  END;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_user_capability(p_user_id uuid, p_capability_key text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'authentication_required';
    END IF;
    IF auth.uid() IS DISTINCT FROM p_user_id THEN
      RAISE EXCEPTION 'resolver_subject_forbidden';
    END IF;
  END IF;

  RETURN app_private.resolve_user_capability(p_user_id, p_capability_key);
END;
$function$;

REVOKE ALL ON FUNCTION public.is_active_global_staff_super_admin(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_approver(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resolve_user_capability(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_active_global_staff_super_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_approver(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_user_capability(uuid, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
