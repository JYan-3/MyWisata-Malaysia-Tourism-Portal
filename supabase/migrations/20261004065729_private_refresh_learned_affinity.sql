ALTER FUNCTION public.refresh_learned_affinity(uuid) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.refresh_learned_affinity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.refresh_learned_affinity(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.refresh_learned_affinity(p_user_id uuid)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.refresh_learned_affinity(p_user_id);
$function$;

REVOKE ALL ON FUNCTION public.refresh_learned_affinity(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_learned_affinity(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
