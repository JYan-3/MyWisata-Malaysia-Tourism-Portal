-- Staff roles count only in an authenticator-verified (aal2) session.
-- Plan: Docs/plans/2026-10-14-1543-staff-two-factor-login.md
--
-- Every staff check in RLS policies and RPCs goes through these four functions.
-- When a signed-in user checks THEIR OWN role and the session is still aal1
-- (password only), the answer is now "no". That blocks a stolen password from
-- using staff powers directly through the Supabase API, not just through the app.
-- Unchanged: checks about another user, the service role (server jobs), anon.
-- Function bodies below are the live definitions with only the guard added.

CREATE OR REPLACE FUNCTION app_private.caller_lacks_aal2(uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(auth.role(), '') = 'authenticated'
     AND uid IS NOT DISTINCT FROM auth.uid()
     AND COALESCE(auth.jwt() ->> 'aal', '') <> 'aal2';
$function$;

REVOKE ALL ON FUNCTION app_private.caller_lacks_aal2(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.caller_lacks_aal2(uuid) TO service_role;

CREATE OR REPLACE FUNCTION app_private.is_admin(uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN auth.role() = 'anon' THEN false
    WHEN app_private.caller_lacks_aal2(uid) THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.user_roles AS assignment
      JOIN public.roles AS role_row ON role_row.id = assignment.role_id
      WHERE assignment.user_id = uid
        AND role_row.name IN ('super_admin', 'approver')
    )
  END;
$function$;

CREATE OR REPLACE FUNCTION app_private.is_super_admin(uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN auth.role() = 'anon' THEN false
    WHEN app_private.caller_lacks_aal2(uid) THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.user_roles AS assignment
      JOIN public.roles AS role_row ON role_row.id = assignment.role_id
      WHERE assignment.user_id = uid
        AND role_row.name = 'super_admin'
    )
  END;
$function$;

CREATE OR REPLACE FUNCTION app_private.is_approver(uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT NOT app_private.caller_lacks_aal2(uid) AND EXISTS (
    SELECT 1 FROM public.user_roles AS assignment
    JOIN public.roles AS role_row ON role_row.id = assignment.role_id
    WHERE assignment.user_id = uid
      AND role_row.name IN ('super_admin', 'approver')
  );
$function$;

CREATE OR REPLACE FUNCTION app_private.has_staff_permission(p_user_id uuid, p_permission_key text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_user_id IS NULL
     OR p_permission_key IS NULL
     OR (
       COALESCE(auth.role(), '') <> 'service_role'
       AND (auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid())
     ) THEN
    RETURN FALSE;
  END IF;

  IF app_private.caller_lacks_aal2(p_user_id) THEN
    RETURN FALSE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.staff_permissions WHERE key = p_permission_key
  ) THEN
    RETURN FALSE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users AS user_row
     WHERE user_row.id = p_user_id AND user_row.status = 'active'
  ) THEN
    RETURN FALSE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.user_roles AS coarse_assignment
      JOIN public.roles AS coarse_role ON coarse_role.id = coarse_assignment.role_id
     WHERE coarse_assignment.user_id = p_user_id
       AND coarse_assignment.vendor_id IS NULL
       AND coarse_assignment.outlet_id IS NULL
       AND coarse_role.name IN ('admin', 'approver', 'super_admin', 'staff')
  ) THEN
    RETURN FALSE;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.user_roles AS coarse_assignment
      JOIN public.roles AS coarse_role ON coarse_role.id = coarse_assignment.role_id
     WHERE coarse_assignment.user_id = p_user_id
       AND coarse_assignment.vendor_id IS NULL
       AND coarse_assignment.outlet_id IS NULL
       AND coarse_role.name = 'super_admin'
  ) THEN
    RETURN TRUE;
  END IF;

  RETURN EXISTS (
    SELECT 1
      FROM public.staff_role_assignments AS role_assignment
      JOIN public.staff_roles AS staff_role
        ON staff_role.id = role_assignment.role_id
       AND staff_role.is_active = TRUE
      JOIN public.staff_role_modules AS role_module
        ON role_module.role_id = staff_role.id
      JOIN public.staff_modules AS module_row
        ON module_row.id = role_module.module_id
       AND module_row.is_active = TRUE
      JOIN public.staff_module_permissions AS module_permission
        ON module_permission.module_id = module_row.id
      JOIN public.staff_permissions AS permission
        ON permission.id = module_permission.permission_id
     WHERE role_assignment.user_id = p_user_id
       AND role_assignment.revoked_at IS NULL
       AND permission.key = p_permission_key
    UNION ALL
    SELECT 1
      FROM public.user_roles AS coarse_assignment
      JOIN public.roles AS coarse_role ON coarse_role.id = coarse_assignment.role_id
      JOIN public.staff_module_legacy_roles AS legacy_module
        ON legacy_module.role_name = coarse_role.name
       AND legacy_module.grants_permissions = TRUE
      JOIN public.staff_modules AS module_row
        ON module_row.id = legacy_module.module_id
       AND module_row.is_active = TRUE
      JOIN public.staff_module_permissions AS module_permission
        ON module_permission.module_id = module_row.id
      JOIN public.staff_permissions AS permission
        ON permission.id = module_permission.permission_id
     WHERE coarse_assignment.user_id = p_user_id
       AND coarse_assignment.vendor_id IS NULL
       AND coarse_assignment.outlet_id IS NULL
       AND permission.key = p_permission_key
  );
EXCEPTION WHEN OTHERS THEN
  RETURN FALSE;
END;
$function$;
