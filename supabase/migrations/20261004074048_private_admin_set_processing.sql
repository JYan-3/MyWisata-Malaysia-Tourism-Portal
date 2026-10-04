-- Keep the Stripe payout write implementation and its existing authorization
-- boundary out of the exposed API schema. The RPC signature and grants remain
-- stable for existing authenticated and service-role callers.
ALTER FUNCTION public.admin_set_processing(uuid, text, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.admin_set_processing(uuid, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.admin_set_processing(uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_set_processing(
  p_withdrawal_id uuid,
  p_transfer_id text,
  p_payout_id text
)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  SELECT app_private.admin_set_processing(
    p_withdrawal_id,
    p_transfer_id,
    p_payout_id
  );
$function$;

REVOKE ALL ON FUNCTION public.admin_set_processing(uuid, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_processing(uuid, text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
