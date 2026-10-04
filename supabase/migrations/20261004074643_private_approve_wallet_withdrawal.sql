-- Keep the approval-cycle/risk-check transaction and its notification/audit
-- writes unchanged behind the existing authenticated RPC API.
ALTER FUNCTION public.approve_wallet_withdrawal(uuid, text, inet, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.approve_wallet_withdrawal(uuid, text, inet, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.approve_wallet_withdrawal(uuid, text, inet, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.approve_wallet_withdrawal(
  p_withdrawal_id uuid,
  p_note text DEFAULT NULL::text,
  p_ip inet DEFAULT NULL::inet,
  p_reason_category text DEFAULT 'review_completed'::text
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.approve_wallet_withdrawal(
    p_withdrawal_id,
    p_note,
    p_ip,
    p_reason_category
  );
$function$;

REVOKE ALL ON FUNCTION public.approve_wallet_withdrawal(uuid, text, inet, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.approve_wallet_withdrawal(uuid, text, inet, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
