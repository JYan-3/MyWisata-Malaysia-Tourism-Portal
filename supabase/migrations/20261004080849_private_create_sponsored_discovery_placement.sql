-- Keep the privileged draft-creation transaction and preview-version check
-- behind the authenticated admin RPC.
ALTER FUNCTION public.create_sponsored_discovery_placement(uuid, text, text, timestamp with time zone, timestamp with time zone, integer, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.create_sponsored_discovery_placement(uuid, text, text, timestamp with time zone, timestamp with time zone, integer, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.create_sponsored_discovery_placement(uuid, text, text, timestamp with time zone, timestamp with time zone, integer, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_sponsored_discovery_placement(
  p_product_id uuid,
  p_state text,
  p_category_slug text,
  p_starts_at timestamp with time zone,
  p_ends_at timestamp with time zone,
  p_priority integer,
  p_preview_version text
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.create_sponsored_discovery_placement(
    p_product_id,
    p_state,
    p_category_slug,
    p_starts_at,
    p_ends_at,
    p_priority,
    p_preview_version
  );
$function$;

REVOKE ALL ON FUNCTION public.create_sponsored_discovery_placement(uuid, text, text, timestamp with time zone, timestamp with time zone, integer, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_sponsored_discovery_placement(uuid, text, text, timestamp with time zone, timestamp with time zone, integer, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
