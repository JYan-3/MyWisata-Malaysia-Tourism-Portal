-- Preserve the legacy authenticated voucher redemption API behind an invoker wrapper.
ALTER FUNCTION public.redeem_voucher(uuid, uuid, uuid, numeric) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.redeem_voucher(uuid, uuid, uuid, numeric) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.redeem_voucher(uuid, uuid, uuid, numeric) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.redeem_voucher(
  p_voucher_id uuid,
  p_order_id uuid,
  p_user_id uuid,
  p_discount numeric
)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.redeem_voucher(
    p_voucher_id,
    p_order_id,
    p_user_id,
    p_discount
  );
$function$;

REVOKE ALL ON FUNCTION public.redeem_voucher(uuid, uuid, uuid, numeric) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.redeem_voucher(uuid, uuid, uuid, numeric) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
