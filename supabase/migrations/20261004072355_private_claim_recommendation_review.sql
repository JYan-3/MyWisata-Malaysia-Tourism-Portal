ALTER FUNCTION public.claim_recommendation_review(uuid) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.claim_recommendation_review(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.claim_recommendation_review(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_recommendation_review(p_recommendation_id uuid)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.claim_recommendation_review(p_recommendation_id);
$function$;

REVOKE ALL ON FUNCTION public.claim_recommendation_review(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.claim_recommendation_review(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
