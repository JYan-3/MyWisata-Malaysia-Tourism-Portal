-- Keep the super-admin-only wallet transaction implementation outside the
-- exposed API schema while preserving the authenticated RPC contract.
ALTER FUNCTION public.apply_wallet_adjustment(uuid, text, text, bigint, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.apply_wallet_adjustment(uuid, text, text, bigint, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.apply_wallet_adjustment(uuid, text, text, bigint, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.apply_wallet_adjustment(
  p_user_id uuid,
  p_bucket text,
  p_direction text,
  p_amount_sen bigint,
  p_reason text
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.apply_wallet_adjustment(
    p_user_id,
    p_bucket,
    p_direction,
    p_amount_sen,
    p_reason
  );
$function$;

REVOKE ALL ON FUNCTION public.apply_wallet_adjustment(uuid, text, text, bigint, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.apply_wallet_adjustment(uuid, text, text, bigint, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
