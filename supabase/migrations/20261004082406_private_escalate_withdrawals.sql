-- Withdrawal escalation is an internal maintenance operation, not a user RPC.
ALTER FUNCTION public.escalate_withdrawals(timestamp with time zone) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.escalate_withdrawals(timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.escalate_withdrawals(timestamp with time zone) TO service_role;

CREATE OR REPLACE FUNCTION public.escalate_withdrawals(
  p_now timestamp with time zone DEFAULT now()
)
RETURNS integer
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.escalate_withdrawals(
    p_now
  );
$function$;

REVOKE ALL ON FUNCTION public.escalate_withdrawals(timestamp with time zone) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.escalate_withdrawals(timestamp with time zone) TO service_role;

NOTIFY pgrst, 'reload schema';
