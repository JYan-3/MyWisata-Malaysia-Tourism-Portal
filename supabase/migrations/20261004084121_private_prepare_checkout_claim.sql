-- Preserve claimed-voucher checkout authorization and transaction semantics.
ALTER FUNCTION public.prepare_checkout(uuid, uuid[], text, text, text, numeric, numeric, numeric, text, uuid, jsonb) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.prepare_checkout(uuid, uuid[], text, text, text, numeric, numeric, numeric, text, uuid, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.prepare_checkout(uuid, uuid[], text, text, text, numeric, numeric, numeric, text, uuid, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.prepare_checkout(
  p_cart_id uuid,
  p_selected_item_ids uuid[],
  p_idempotency_key text,
  p_request_hash text,
  p_payment_method text,
  p_subtotal numeric,
  p_discount numeric,
  p_total numeric,
  p_voucher_code text,
  p_claim_id uuid,
  p_lines jsonb
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.prepare_checkout(
    p_cart_id,
    p_selected_item_ids,
    p_idempotency_key,
    p_request_hash,
    p_payment_method,
    p_subtotal,
    p_discount,
    p_total,
    p_voucher_code,
    p_claim_id,
    p_lines
  );
$function$;

REVOKE ALL ON FUNCTION public.prepare_checkout(uuid, uuid[], text, text, text, numeric, numeric, numeric, text, uuid, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.prepare_checkout(uuid, uuid[], text, text, text, numeric, numeric, numeric, text, uuid, jsonb) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
