ALTER FUNCTION public.admin_review_recommendation_translation(uuid, uuid, text, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.admin_review_recommendation_translation(uuid, uuid, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.admin_review_recommendation_translation(uuid, uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_review_recommendation_translation(
  p_translation_id uuid,
  p_rec_id uuid,
  p_translated_text text,
  p_status text
)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.admin_review_recommendation_translation(
    p_translation_id,
    p_rec_id,
    p_translated_text,
    p_status
  );
$function$;

REVOKE ALL ON FUNCTION public.admin_review_recommendation_translation(uuid, uuid, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_review_recommendation_translation(uuid, uuid, text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
