-- Preserve the authenticated wallet checkout flow and its ownership checks.
ALTER FUNCTION public.finalize_customer_wallet_checkout(uuid, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.finalize_customer_wallet_checkout(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.finalize_customer_wallet_checkout(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.finalize_customer_wallet_checkout(
  p_checkout_session_id uuid,
  p_outcome text
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.finalize_customer_wallet_checkout(
    p_checkout_session_id,
    p_outcome
  );
$function$;

REVOKE ALL ON FUNCTION public.finalize_customer_wallet_checkout(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_customer_wallet_checkout(uuid, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
