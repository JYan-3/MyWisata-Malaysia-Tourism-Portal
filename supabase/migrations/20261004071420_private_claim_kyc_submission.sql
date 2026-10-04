ALTER FUNCTION public.claim_kyc_submission(uuid) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.claim_kyc_submission(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.claim_kyc_submission(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_kyc_submission(p_submission_id uuid)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.claim_kyc_submission(p_submission_id);
$function$;

REVOKE ALL ON FUNCTION public.claim_kyc_submission(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_kyc_submission(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
