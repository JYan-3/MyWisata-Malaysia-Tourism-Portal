-- Keep withdrawal risk calculation and assessment persistence unchanged behind
-- the existing authenticated/service-role RPC surface.
ALTER FUNCTION public.assess_withdrawal_risk(uuid) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.assess_withdrawal_risk(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.assess_withdrawal_risk(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.assess_withdrawal_risk(
  p_withdrawal_id uuid
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.assess_withdrawal_risk(
    p_withdrawal_id
  );
$function$;

REVOKE ALL ON FUNCTION public.assess_withdrawal_risk(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.assess_withdrawal_risk(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
