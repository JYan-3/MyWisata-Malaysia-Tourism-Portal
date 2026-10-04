ALTER FUNCTION public.mark_vendor_announcement_read(uuid) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.mark_vendor_announcement_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.mark_vendor_announcement_read(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.mark_vendor_announcement_read(p_announcement_id uuid)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.mark_vendor_announcement_read(p_announcement_id);
$function$;

REVOKE ALL ON FUNCTION public.mark_vendor_announcement_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_vendor_announcement_read(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
