-- Preserve the existing authenticated withdrawal flow while hiding its definer body.
ALTER FUNCTION public.debit_withdrawal(uuid, numeric) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.debit_withdrawal(uuid, numeric) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.debit_withdrawal(uuid, numeric) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.debit_withdrawal(
  p_user_id uuid,
  p_amount_rm numeric
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.debit_withdrawal(
    p_user_id,
    p_amount_rm
  );
$function$;

REVOKE ALL ON FUNCTION public.debit_withdrawal(uuid, numeric) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.debit_withdrawal(uuid, numeric) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
