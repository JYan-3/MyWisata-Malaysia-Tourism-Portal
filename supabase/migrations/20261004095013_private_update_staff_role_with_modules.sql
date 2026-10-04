-- Preserve staff role/module governance, permission expansion, and audit behavior.
ALTER FUNCTION public.update_staff_role_with_modules(uuid, text, text, text[], boolean, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.update_staff_role_with_modules(uuid, text, text, text[], boolean, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.update_staff_role_with_modules(uuid, text, text, text[], boolean, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_staff_role_with_modules(
  p_role_id uuid,
  p_name text,
  p_description text,
  p_module_keys text[],
  p_active boolean,
  p_reason text
)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.update_staff_role_with_modules(
    p_role_id,
    p_name,
    p_description,
    p_module_keys,
    p_active,
    p_reason
  );
$function$;

REVOKE ALL ON FUNCTION public.update_staff_role_with_modules(uuid, text, text, text[], boolean, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_staff_role_with_modules(uuid, text, text, text[], boolean, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
