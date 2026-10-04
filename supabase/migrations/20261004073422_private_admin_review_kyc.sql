ALTER FUNCTION public.admin_review_kyc(uuid, uuid, text, text, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.admin_review_kyc(uuid, uuid, text, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.admin_review_kyc(uuid, uuid, text, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_review_kyc(
  p_submission_id uuid,
  p_user_id uuid,
  p_action text,
  p_reason_code text DEFAULT NULL::text,
  p_reason_detail text DEFAULT NULL::text
)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.admin_review_kyc(
    p_submission_id,
    p_user_id,
    p_action,
    p_reason_code,
    p_reason_detail
  );
$function$;

REVOKE ALL ON FUNCTION public.admin_review_kyc(uuid, uuid, text, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_review_kyc(uuid, uuid, text, text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
