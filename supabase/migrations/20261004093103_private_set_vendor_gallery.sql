-- Preserve vendor ownership checks and atomic gallery replacement behind a narrow RPC wrapper.
ALTER FUNCTION public.set_vendor_gallery(uuid, jsonb) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.set_vendor_gallery(uuid, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.set_vendor_gallery(uuid, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_vendor_gallery(
  p_vendor_id uuid,
  p_gallery jsonb
)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.set_vendor_gallery(
    p_vendor_id,
    p_gallery
  );
$function$;

REVOKE ALL ON FUNCTION public.set_vendor_gallery(uuid, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.set_vendor_gallery(uuid, jsonb) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
