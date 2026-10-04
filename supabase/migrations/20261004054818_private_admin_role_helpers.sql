-- Keep RLS and SECURITY DEFINER callers bound to the original helper OIDs.
ALTER FUNCTION public.is_admin(UUID) SET SCHEMA app_private;
ALTER FUNCTION public.is_super_admin(UUID) SET SCHEMA app_private;

-- These helpers remain available to policy expressions, including anonymous
-- policies that must evaluate them to false. app_private is not API-exposed.
GRANT USAGE ON SCHEMA app_private TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.is_admin(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.is_super_admin(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.is_admin(UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.is_super_admin(UUID) TO anon, authenticated, service_role;

-- Public RPC wrappers only allow authenticated users to query their own role.
-- Existing postgres-owned SECURITY DEFINER callers retain their prior actor
-- checks because CURRENT_USER remains the function owner inside those calls.
CREATE OR REPLACE FUNCTION public.is_admin(uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN current_user = 'authenticated' AND uid IS DISTINCT FROM auth.uid() THEN false
    ELSE app_private.is_admin(uid)
  END;
$function$;

CREATE OR REPLACE FUNCTION public.is_super_admin(uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN current_user = 'authenticated' AND uid IS DISTINCT FROM auth.uid() THEN false
    ELSE app_private.is_super_admin(uid)
  END;
$function$;

REVOKE ALL ON FUNCTION public.is_admin(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_super_admin(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_super_admin(UUID) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
