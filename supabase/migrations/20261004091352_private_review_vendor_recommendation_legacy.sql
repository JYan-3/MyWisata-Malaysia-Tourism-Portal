-- Preserve the legacy authenticated vendor recommendation review API.
ALTER FUNCTION public.review_vendor_recommendation(uuid, text, uuid) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.review_vendor_recommendation(uuid, text, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.review_vendor_recommendation(uuid, text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.review_vendor_recommendation(
  p_recommendation_id uuid,
  p_action text,
  p_admin_id uuid
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.review_vendor_recommendation(
    p_recommendation_id,
    p_action,
    p_admin_id
  );
$function$;

REVOKE ALL ON FUNCTION public.review_vendor_recommendation(uuid, text, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.review_vendor_recommendation(uuid, text, uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
