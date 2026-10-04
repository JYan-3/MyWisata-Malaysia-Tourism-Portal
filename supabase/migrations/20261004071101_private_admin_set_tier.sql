ALTER FUNCTION public.admin_set_tier(uuid, text, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.admin_set_tier(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.admin_set_tier(uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_set_tier(
  p_user_id uuid,
  p_tier text,
  p_reason text DEFAULT NULL::text
)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  SELECT app_private.admin_set_tier(p_user_id, p_tier, p_reason);
$function$;

REVOKE ALL ON FUNCTION public.admin_set_tier(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_tier(uuid, text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
