-- Preserve the public active-placement listing while moving its privileged
-- table access out of the exposed Data API schema.
ALTER FUNCTION public.list_active_sponsored_discovery_placements() SET SCHEMA app_private;

GRANT USAGE ON SCHEMA app_private TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.list_active_sponsored_discovery_placements() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.list_active_sponsored_discovery_placements() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_active_sponsored_discovery_placements()
RETURNS TABLE(
  id UUID,
  product_id UUID,
  state TEXT,
  category_slug TEXT,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  priority INTEGER,
  status TEXT
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT * FROM app_private.list_active_sponsored_discovery_placements();
$function$;

REVOKE ALL ON FUNCTION public.list_active_sponsored_discovery_placements() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_active_sponsored_discovery_placements() TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
