-- Preserve the live vendor review workflow and audit path behind a narrow RPC wrapper.
ALTER FUNCTION public.staff_review_vendor(uuid, text, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.staff_review_vendor(uuid, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.staff_review_vendor(uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.staff_review_vendor(
  p_vendor_id uuid,
  p_action text,
  p_reason text
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.staff_review_vendor(
    p_vendor_id,
    p_action,
    p_reason
  );
$function$;

REVOKE ALL ON FUNCTION public.staff_review_vendor(uuid, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.staff_review_vendor(uuid, text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
