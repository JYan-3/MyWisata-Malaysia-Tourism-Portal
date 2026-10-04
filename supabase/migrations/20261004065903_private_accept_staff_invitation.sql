ALTER FUNCTION public.accept_staff_invitation(text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.accept_staff_invitation(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.accept_staff_invitation(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.accept_staff_invitation(p_token_hash text)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
  SELECT app_private.accept_staff_invitation(p_token_hash);
$function$;

REVOKE ALL ON FUNCTION public.accept_staff_invitation(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_staff_invitation(text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
