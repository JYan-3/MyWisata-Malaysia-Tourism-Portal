-- Keep the original SECURITY DEFINER implementation and policy OID in the
-- existing private schema; the public RPC becomes an invoker-only façade.
ALTER FUNCTION public.can_manage_vendor_events(UUID) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.can_manage_vendor_events(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.can_manage_vendor_events(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_manage_vendor_events(p_vendor_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.can_manage_vendor_events(p_vendor_id);
$function$;

REVOKE ALL ON FUNCTION public.can_manage_vendor_events(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_vendor_events(UUID) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
