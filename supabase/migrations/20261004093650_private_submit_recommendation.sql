-- Preserve the live rate-limited customer recommendation workflow and optional API arguments.
ALTER FUNCTION public.submit_recommendation(text, text, text, uuid, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.submit_recommendation(text, text, text, uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.submit_recommendation(text, text, text, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.submit_recommendation(
  p_vendor_name text,
  p_description text,
  p_state text DEFAULT NULL,
  p_category_id uuid DEFAULT NULL,
  p_vendor_address text DEFAULT NULL
)
RETURNS uuid
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.submit_recommendation(
    p_vendor_name,
    p_description,
    p_state,
    p_category_id,
    p_vendor_address
  );
$function$;

REVOKE ALL ON FUNCTION public.submit_recommendation(text, text, text, uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.submit_recommendation(text, text, text, uuid, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
