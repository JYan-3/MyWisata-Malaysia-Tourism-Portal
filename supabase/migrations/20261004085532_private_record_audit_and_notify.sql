-- Preserve the authenticated audit and recipient-checked notification API.
ALTER FUNCTION public.record_audit_and_notify(character varying, character varying, uuid, jsonb, jsonb, text, jsonb) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.record_audit_and_notify(character varying, character varying, uuid, jsonb, jsonb, text, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.record_audit_and_notify(character varying, character varying, uuid, jsonb, jsonb, text, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_audit_and_notify(
  p_action character varying,
  p_entity_type character varying,
  p_entity_id uuid,
  p_before_data jsonb DEFAULT NULL,
  p_after_data jsonb DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_notifications jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.record_audit_and_notify(
    p_action,
    p_entity_type,
    p_entity_id,
    p_before_data,
    p_after_data,
    p_note,
    p_notifications
  );
$function$;

REVOKE ALL ON FUNCTION public.record_audit_and_notify(character varying, character varying, uuid, jsonb, jsonb, text, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_audit_and_notify(character varying, character varying, uuid, jsonb, jsonb, text, jsonb) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
