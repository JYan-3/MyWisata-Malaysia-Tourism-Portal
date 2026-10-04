-- Keep wallet-approver governance and its final-reviewer guard unchanged.
ALTER FUNCTION public.manage_wallet_approver(uuid, text, text, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.manage_wallet_approver(uuid, text, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.manage_wallet_approver(uuid, text, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.manage_wallet_approver(
  p_target_user_id uuid,
  p_action text,
  p_reason_category text,
  p_note text
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.manage_wallet_approver(
    p_target_user_id,
    p_action,
    p_reason_category,
    p_note
  );
$function$;

REVOKE ALL ON FUNCTION public.manage_wallet_approver(uuid, text, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.manage_wallet_approver(uuid, text, text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
