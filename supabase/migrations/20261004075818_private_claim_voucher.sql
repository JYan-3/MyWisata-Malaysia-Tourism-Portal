-- Keep the voucher claim transaction and its authenticated ownership check
-- unchanged behind the existing customer RPC contract.
ALTER FUNCTION public.claim_voucher(uuid) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.claim_voucher(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.claim_voucher(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_voucher(
  p_voucher_id uuid
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.claim_voucher(
    p_voucher_id
  );
$function$;

REVOKE ALL ON FUNCTION public.claim_voucher(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.claim_voucher(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
