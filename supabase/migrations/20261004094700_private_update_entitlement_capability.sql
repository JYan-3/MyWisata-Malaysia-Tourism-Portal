-- Preserve entitlement capability governance and generation auditing behind an authenticated-only wrapper.
ALTER FUNCTION public.update_entitlement_capability(text, text, text, boolean, boolean, boolean, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.update_entitlement_capability(text, text, text, boolean, boolean, boolean, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.update_entitlement_capability(text, text, text, boolean, boolean, boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_entitlement_capability(
  p_capability_key text,
  p_category text,
  p_risk_level text,
  p_customer_visible boolean,
  p_manually_assignable boolean,
  p_enabled boolean,
  p_reason text
)
RETURNS uuid
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.update_entitlement_capability(
    p_capability_key,
    p_category,
    p_risk_level,
    p_customer_visible,
    p_manually_assignable,
    p_enabled,
    p_reason
  );
$function$;

REVOKE ALL ON FUNCTION public.update_entitlement_capability(text, text, text, boolean, boolean, boolean, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.update_entitlement_capability(text, text, text, boolean, boolean, boolean, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
