-- Preserve the super-admin policy/version validation and approval/audit
-- staging writes behind the existing authenticated RPC.
ALTER FUNCTION public.create_entitlement_policy_version(uuid, text, timestamp with time zone, timestamp with time zone, jsonb, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.create_entitlement_policy_version(uuid, text, timestamp with time zone, timestamp with time zone, jsonb, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.create_entitlement_policy_version(uuid, text, timestamp with time zone, timestamp with time zone, jsonb, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_entitlement_policy_version(
  p_policy_id uuid,
  p_effect text,
  p_effective_from timestamp with time zone,
  p_effective_until timestamp with time zone,
  p_requirements jsonb,
  p_reason text
)
RETURNS uuid
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.create_entitlement_policy_version(
    p_policy_id,
    p_effect,
    p_effective_from,
    p_effective_until,
    p_requirements,
    p_reason
  );
$function$;

REVOKE ALL ON FUNCTION public.create_entitlement_policy_version(uuid, text, timestamp with time zone, timestamp with time zone, jsonb, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_entitlement_policy_version(uuid, text, timestamp with time zone, timestamp with time zone, jsonb, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
