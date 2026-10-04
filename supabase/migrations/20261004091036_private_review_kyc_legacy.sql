-- Preserve the legacy administrator KYC review API behind an invoker wrapper.
ALTER FUNCTION public.review_kyc(uuid, uuid, character varying, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.review_kyc(uuid, uuid, character varying, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.review_kyc(uuid, uuid, character varying, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.review_kyc(
  p_submission_id uuid,
  p_admin_id uuid,
  p_action character varying,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.review_kyc(
    p_submission_id,
    p_admin_id,
    p_action,
    p_reason
  );
$function$;

REVOKE ALL ON FUNCTION public.review_kyc(uuid, uuid, character varying, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.review_kyc(uuid, uuid, character varying, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
