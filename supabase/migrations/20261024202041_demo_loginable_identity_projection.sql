-- Keep the login picker bounded to seeded identities instead of paging through
-- every Auth user as the customer base grows.
CREATE OR REPLACE FUNCTION app_private.list_loginable_demo_user_ids()
RETURNS TABLE(user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'auth', 'pg_temp'
AS $function$
  SELECT auth_user.id
  FROM auth.users AS auth_user
  JOIN public.users AS app_user ON app_user.id = auth_user.id
  WHERE lower(coalesce(app_user.email, '')) LIKE '%@demo.local'
    AND auth_user.deleted_at IS NULL
    AND (auth_user.banned_until IS NULL OR auth_user.banned_until <= now())
    AND EXISTS (
      SELECT 1
      FROM public.user_roles AS user_role
      JOIN public.roles AS role ON role.id = user_role.role_id
      WHERE user_role.user_id = auth_user.id
        AND role.name IS NOT NULL
    )
  ORDER BY lower(app_user.email), auth_user.id;
$function$;

REVOKE ALL ON FUNCTION app_private.list_loginable_demo_user_ids() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.list_loginable_demo_user_ids() TO service_role;

CREATE OR REPLACE FUNCTION public.list_loginable_demo_user_ids()
RETURNS TABLE(user_id uuid)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT * FROM app_private.list_loginable_demo_user_ids();
$function$;

REVOKE ALL ON FUNCTION public.list_loginable_demo_user_ids() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_loginable_demo_user_ids() TO service_role;

NOTIFY pgrst, 'reload schema';
