ALTER FUNCTION public.admin_review_recommendation(uuid, text, text, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.admin_review_recommendation(uuid, text, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.admin_review_recommendation(uuid, text, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_review_recommendation(
  p_rec_id uuid,
  p_action text,
  p_internal_note text DEFAULT NULL::text,
  p_customer_message text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.admin_review_recommendation(
    p_rec_id,
    p_action,
    p_internal_note,
    p_customer_message
  );
$function$;

REVOKE ALL ON FUNCTION public.admin_review_recommendation(uuid, text, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_review_recommendation(uuid, text, text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
