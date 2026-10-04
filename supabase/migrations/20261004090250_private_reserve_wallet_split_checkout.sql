-- Preserve the customer-owned wallet split reservation transaction.
ALTER FUNCTION public.reserve_wallet_split_checkout(uuid) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.reserve_wallet_split_checkout(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.reserve_wallet_split_checkout(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reserve_wallet_split_checkout(p_checkout_session_id uuid)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.reserve_wallet_split_checkout(p_checkout_session_id);
$function$;

REVOKE ALL ON FUNCTION public.reserve_wallet_split_checkout(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.reserve_wallet_split_checkout(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
