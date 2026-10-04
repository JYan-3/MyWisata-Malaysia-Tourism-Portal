-- Preserve entitlement assignment governance and auditing behind an authenticated-only wrapper.
ALTER FUNCTION public.set_entitlement_assignment(text, text, text, text, timestamp with time zone, timestamp with time zone, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.set_entitlement_assignment(text, text, text, text, timestamp with time zone, timestamp with time zone, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.set_entitlement_assignment(text, text, text, text, timestamp with time zone, timestamp with time zone, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_entitlement_assignment(
  p_subject_type text,
  p_subject_id text,
  p_capability_key text,
  p_effect text,
  p_starts_at timestamp with time zone,
  p_expires_at timestamp with time zone,
  p_reason text
)
RETURNS uuid
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.set_entitlement_assignment(
    p_subject_type,
    p_subject_id,
    p_capability_key,
    p_effect,
    p_starts_at,
    p_expires_at,
    p_reason
  );
$function$;

REVOKE ALL ON FUNCTION public.set_entitlement_assignment(text, text, text, text, timestamp with time zone, timestamp with time zone, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.set_entitlement_assignment(text, text, text, text, timestamp with time zone, timestamp with time zone, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
