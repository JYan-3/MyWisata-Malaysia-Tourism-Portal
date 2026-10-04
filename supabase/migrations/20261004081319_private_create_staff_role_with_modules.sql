-- Keep governed role creation and permission synchronization behind its existing RPC.
ALTER FUNCTION public.create_staff_role_with_modules(text, text, text[], text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.create_staff_role_with_modules(text, text, text[], text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.create_staff_role_with_modules(text, text, text[], text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_staff_role_with_modules(
  p_name text,
  p_description text,
  p_module_keys text[],
  p_reason text
)
RETURNS uuid
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.create_staff_role_with_modules(
    p_name,
    p_description,
    p_module_keys,
    p_reason
  );
$function$;

REVOKE ALL ON FUNCTION public.create_staff_role_with_modules(text, text, text[], text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_staff_role_with_modules(text, text, text[], text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
