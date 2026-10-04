-- Keep module/permission creation and its validation/audit transaction behind
-- the existing authenticated super-admin RPC.
ALTER FUNCTION public.create_staff_module(text, text, text, text, text, text, text, integer, text, text, integer, text[], text, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.create_staff_module(text, text, text, text, text, text, text, integer, text, text, integer, text[], text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.create_staff_module(text, text, text, text, text, text, text, integer, text, text, integer, text[], text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_staff_module(
  p_key text,
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
  p_reason text
)
RETURNS uuid
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.create_staff_module(
    p_key,
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
    p_reason
  );
$function$;

REVOKE ALL ON FUNCTION public.create_staff_module(text, text, text, text, text, text, text, integer, text, text, integer, text[], text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_staff_module(text, text, text, text, text, text, text, integer, text, text, integer, text[], text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
