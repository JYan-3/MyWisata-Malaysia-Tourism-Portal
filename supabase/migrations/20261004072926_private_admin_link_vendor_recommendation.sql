ALTER FUNCTION public.admin_link_vendor_recommendation(uuid, uuid) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.admin_link_vendor_recommendation(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.admin_link_vendor_recommendation(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_link_vendor_recommendation(p_vendor_id uuid, p_rec_id uuid)
RETURNS uuid
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.admin_link_vendor_recommendation(p_vendor_id, p_rec_id);
$function$;

REVOKE ALL ON FUNCTION public.admin_link_vendor_recommendation(uuid, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_link_vendor_recommendation(uuid, uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
