-- Keep the user-owned KYC submit flow and its Storage/document checks intact.
ALTER FUNCTION public.finalize_kyc_submission(uuid, text, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.finalize_kyc_submission(uuid, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.finalize_kyc_submission(uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.finalize_kyc_submission(
  p_submission_id uuid,
  p_front_path text,
  p_back_path text
)
RETURNS uuid
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.finalize_kyc_submission(
    p_submission_id,
    p_front_path,
    p_back_path
  );
$function$;

REVOKE ALL ON FUNCTION public.finalize_kyc_submission(uuid, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_kyc_submission(uuid, text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
