-- Preserve controlled withdrawal review resumption and default audit metadata.
ALTER FUNCTION public.resume_wallet_withdrawal(uuid, text, inet, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.resume_wallet_withdrawal(uuid, text, inet, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.resume_wallet_withdrawal(uuid, text, inet, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.resume_wallet_withdrawal(
  p_id uuid,
  p_reason text,
  p_ip inet DEFAULT NULL,
  p_reason_category text DEFAULT 'other'
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.resume_wallet_withdrawal(
    p_id,
    p_reason,
    p_ip,
    p_reason_category
  );
$function$;

REVOKE ALL ON FUNCTION public.resume_wallet_withdrawal(uuid, text, inet, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.resume_wallet_withdrawal(uuid, text, inet, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
