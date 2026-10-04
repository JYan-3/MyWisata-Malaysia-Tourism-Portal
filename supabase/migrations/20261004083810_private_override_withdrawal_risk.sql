-- Keep high-risk withdrawal overrides behind the existing super-admin guard.
ALTER FUNCTION public.override_withdrawal_risk(uuid, text, inet) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.override_withdrawal_risk(uuid, text, inet) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.override_withdrawal_risk(uuid, text, inet) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.override_withdrawal_risk(
  p_withdrawal_id uuid,
  p_reason text,
  p_ip inet DEFAULT NULL::inet
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.override_withdrawal_risk(
    p_withdrawal_id,
    p_reason,
    p_ip
  );
$function$;

REVOKE ALL ON FUNCTION public.override_withdrawal_risk(uuid, text, inet) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.override_withdrawal_risk(uuid, text, inet) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
