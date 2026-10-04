ALTER FUNCTION public.admin_resolve_recommendation_place(uuid, text, uuid) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.admin_resolve_recommendation_place(uuid, text, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.admin_resolve_recommendation_place(uuid, text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_resolve_recommendation_place(
  p_rec_id uuid,
  p_action text,
  p_place_id uuid DEFAULT NULL::uuid
)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.admin_resolve_recommendation_place(p_rec_id, p_action, p_place_id);
$function$;

REVOKE ALL ON FUNCTION public.admin_resolve_recommendation_place(uuid, text, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_resolve_recommendation_place(uuid, text, uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
