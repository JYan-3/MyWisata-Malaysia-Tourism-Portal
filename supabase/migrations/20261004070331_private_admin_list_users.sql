ALTER FUNCTION public.admin_list_users(text, text, text, text, boolean, integer, integer) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.admin_list_users(text, text, text, text, boolean, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.admin_list_users(text, text, text, text, boolean, integer, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_list_users(
  p_search text DEFAULT NULL::text,
  p_role text DEFAULT NULL::text,
  p_status text DEFAULT NULL::text,
  p_kyc_status text DEFAULT NULL::text,
  p_bio_locked boolean DEFAULT NULL::boolean,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 15
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.admin_list_users(p_search, p_role, p_status, p_kyc_status, p_bio_locked, p_page, p_page_size);
$function$;

REVOKE ALL ON FUNCTION public.admin_list_users(text, text, text, text, boolean, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_users(text, text, text, text, boolean, integer, integer) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
