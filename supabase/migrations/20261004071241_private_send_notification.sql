ALTER FUNCTION public.send_notification(uuid, character varying, character varying, text, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.send_notification(uuid, character varying, character varying, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.send_notification(uuid, character varying, character varying, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.send_notification(
  p_user_id uuid,
  p_type character varying,
  p_title character varying,
  p_body text DEFAULT NULL::text,
  p_link text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  SELECT app_private.send_notification(p_user_id, p_type, p_title, p_body, p_link);
$function$;

REVOKE ALL ON FUNCTION public.send_notification(uuid, character varying, character varying, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_notification(uuid, character varying, character varying, text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
