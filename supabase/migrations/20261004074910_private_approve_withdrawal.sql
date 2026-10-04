-- Preserve the legacy, caller-bound withdrawal approval contract without
-- exposing its definer implementation through the PostgREST schema.
ALTER FUNCTION public.approve_withdrawal(uuid, uuid, character varying, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.approve_withdrawal(uuid, uuid, character varying, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.approve_withdrawal(uuid, uuid, character varying, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.approve_withdrawal(
  p_request_id uuid,
  p_approver_id uuid,
  p_action character varying,
  p_note text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  SELECT app_private.approve_withdrawal(
    p_request_id,
    p_approver_id,
    p_action,
    p_note
  );
$function$;

REVOKE ALL ON FUNCTION public.approve_withdrawal(uuid, uuid, character varying, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.approve_withdrawal(uuid, uuid, character varying, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
