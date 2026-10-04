-- Preserve staff invitation resend controls behind an invoker-security API.
ALTER FUNCTION public.prepare_staff_invitation_resend(uuid, text, timestamp with time zone) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.prepare_staff_invitation_resend(uuid, text, timestamp with time zone) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.prepare_staff_invitation_resend(uuid, text, timestamp with time zone) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.prepare_staff_invitation_resend(
  p_invitation_id uuid,
  p_token_hash text,
  p_expires_at timestamp with time zone
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.prepare_staff_invitation_resend(
    p_invitation_id,
    p_token_hash,
    p_expires_at
  );
$function$;

REVOKE ALL ON FUNCTION public.prepare_staff_invitation_resend(uuid, text, timestamp with time zone) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.prepare_staff_invitation_resend(uuid, text, timestamp with time zone) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
