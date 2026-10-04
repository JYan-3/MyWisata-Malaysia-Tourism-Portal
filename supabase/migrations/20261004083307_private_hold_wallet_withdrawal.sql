-- Preserve the existing permission-gated withdrawal moderation RPC.
ALTER FUNCTION public.hold_wallet_withdrawal(uuid, text, inet, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.hold_wallet_withdrawal(uuid, text, inet, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.hold_wallet_withdrawal(uuid, text, inet, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.hold_wallet_withdrawal(
  p_id uuid,
  p_reason text,
  p_ip inet DEFAULT NULL::inet,
  p_reason_category text DEFAULT 'other'::text
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.hold_wallet_withdrawal(
    p_id,
    p_reason,
    p_ip,
    p_reason_category
  );
$function$;

REVOKE ALL ON FUNCTION public.hold_wallet_withdrawal(uuid, text, inet, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.hold_wallet_withdrawal(uuid, text, inet, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
