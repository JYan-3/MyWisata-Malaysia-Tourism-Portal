-- Payout reports contain wallet and user details; generation is server-only.
ALTER FUNCTION public.generate_monthly_payout_report(date, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.generate_monthly_payout_report(date, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.generate_monthly_payout_report(date, text) TO service_role;

CREATE OR REPLACE FUNCTION public.generate_monthly_payout_report(
  p_period_start date,
  p_generated_by text DEFAULT 'scheduler'::text
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.generate_monthly_payout_report(
    p_period_start,
    p_generated_by
  );
$function$;

REVOKE ALL ON FUNCTION public.generate_monthly_payout_report(date, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.generate_monthly_payout_report(date, text) TO service_role;

NOTIFY pgrst, 'reload schema';
