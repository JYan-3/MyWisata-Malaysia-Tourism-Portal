ALTER FUNCTION public.preview_sponsored_discovery_placement(uuid, uuid, text, text, timestamp with time zone, timestamp with time zone, integer) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.preview_sponsored_discovery_placement(uuid, uuid, text, text, timestamp with time zone, timestamp with time zone, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.preview_sponsored_discovery_placement(uuid, uuid, text, text, timestamp with time zone, timestamp with time zone, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.preview_sponsored_discovery_placement(
  p_placement_id uuid,
  p_product_id uuid,
  p_state text,
  p_category_slug text,
  p_starts_at timestamp with time zone,
  p_ends_at timestamp with time zone,
  p_priority integer
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.preview_sponsored_discovery_placement(
    p_placement_id,
    p_product_id,
    p_state,
    p_category_slug,
    p_starts_at,
    p_ends_at,
    p_priority
  );
$function$;

REVOKE ALL ON FUNCTION public.preview_sponsored_discovery_placement(uuid, uuid, text, text, timestamp with time zone, timestamp with time zone, integer) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.preview_sponsored_discovery_placement(uuid, uuid, text, text, timestamp with time zone, timestamp with time zone, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
