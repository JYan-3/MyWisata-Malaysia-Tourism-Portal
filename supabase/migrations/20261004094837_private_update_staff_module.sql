-- Preserve staff module governance, permission synchronization, and audit behavior.
ALTER FUNCTION public.update_staff_module(uuid, text, text, text, text, text, text, integer, text, text, integer, text[], text, boolean, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.update_staff_module(uuid, text, text, text, text, text, text, integer, text, text, integer, text[], text, boolean, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.update_staff_module(uuid, text, text, text, text, text, text, integer, text, text, integer, text[], text, boolean, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_staff_module(
  p_module_id uuid,
  p_label text,
  p_label_key text,
  p_description text,
  p_section_key text,
  p_section_label text,
  p_section_label_key text,
  p_section_sort_order integer,
  p_href text,
  p_icon_key text,
  p_sort_order integer,
  p_permission_keys text[],
  p_group_key text,
  p_active boolean,
  p_reason text
)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.update_staff_module(
    p_module_id,
    p_label,
    p_label_key,
    p_description,
    p_section_key,
    p_section_label,
    p_section_label_key,
    p_section_sort_order,
    p_href,
    p_icon_key,
    p_sort_order,
    p_permission_keys,
    p_group_key,
    p_active,
    p_reason
  );
$function$;

REVOKE ALL ON FUNCTION public.update_staff_module(uuid, text, text, text, text, text, text, integer, text, text, integer, text[], text, boolean, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_staff_module(uuid, text, text, text, text, text, text, integer, text, text, integer, text[], text, boolean, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
