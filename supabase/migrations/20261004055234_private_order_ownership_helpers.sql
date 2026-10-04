-- Preserve the original helper OIDs referenced by order RLS policies.
ALTER FUNCTION public.order_owned_by(UUID, UUID) SET SCHEMA app_private;
ALTER FUNCTION public.order_has_vendor_item(UUID, UUID) SET SCHEMA app_private;

-- Anonymous policies use these helpers to resolve to false. Keep the private
-- OIDs executable by policy roles while app_private stays outside the API.
GRANT USAGE ON SCHEMA app_private TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.order_owned_by(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.order_has_vendor_item(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.order_owned_by(UUID, UUID) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.order_has_vendor_item(UUID, UUID) TO anon, authenticated, service_role;

-- Keep the exposed RPC contract, but prevent authenticated callers from
-- probing another user's order ownership or vendor relationship.
CREATE OR REPLACE FUNCTION public.order_owned_by(p_order_id UUID, p_uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN current_user = 'authenticated' AND p_uid IS DISTINCT FROM auth.uid() THEN false
    ELSE app_private.order_owned_by(p_order_id, p_uid)
  END;
$function$;

CREATE OR REPLACE FUNCTION public.order_has_vendor_item(p_order_id UUID, p_uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN current_user = 'authenticated' AND p_uid IS DISTINCT FROM auth.uid() THEN false
    ELSE app_private.order_has_vendor_item(p_order_id, p_uid)
  END;
$function$;

REVOKE ALL ON FUNCTION public.order_owned_by(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.order_has_vendor_item(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.order_owned_by(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.order_has_vendor_item(UUID, UUID) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
