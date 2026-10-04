ALTER FUNCTION public.can_review_recommendation(uuid) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.can_review_recommendation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.can_review_recommendation(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_review_recommendation(uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN auth.role() = 'service_role' THEN app_private.can_review_recommendation(uid)
    WHEN auth.role() = 'authenticated' AND uid = auth.uid() THEN app_private.can_review_recommendation(uid)
    ELSE false
  END;
$function$;

REVOKE ALL ON FUNCTION public.can_review_recommendation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_review_recommendation(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
