ALTER FUNCTION public.gen_affiliate_code(uuid) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.gen_affiliate_code(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.gen_affiliate_code(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.gen_affiliate_code(p_user_id uuid)
RETURNS text
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'extensions', 'public', 'pg_temp'
AS $function$
  SELECT app_private.gen_affiliate_code(p_user_id);
$function$;

REVOKE ALL ON FUNCTION public.gen_affiliate_code(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gen_affiliate_code(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
