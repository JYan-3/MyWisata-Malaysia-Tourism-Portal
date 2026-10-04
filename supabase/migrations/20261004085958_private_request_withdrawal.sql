-- Preserve customer withdrawal ownership and wallet balance validation.
ALTER FUNCTION public.request_withdrawal(uuid, numeric, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.request_withdrawal(uuid, numeric, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.request_withdrawal(uuid, numeric, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.request_withdrawal(
  p_user_id uuid,
  p_amount_rm numeric,
  p_destination_label text
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.request_withdrawal(
    p_user_id,
    p_amount_rm,
    p_destination_label
  );
$function$;

REVOKE ALL ON FUNCTION public.request_withdrawal(uuid, numeric, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(uuid, numeric, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
