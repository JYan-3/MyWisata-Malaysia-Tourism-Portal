-- Preserve staff invitation authorization and creation behind an invoker API.
ALTER FUNCTION public.prepare_staff_invitation(text, uuid, text, text, timestamp with time zone) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.prepare_staff_invitation(text, uuid, text, text, timestamp with time zone) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.prepare_staff_invitation(text, uuid, text, text, timestamp with time zone) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.prepare_staff_invitation(
  p_invited_email text,
  p_staff_role_id uuid,
  p_reason text,
  p_token_hash text,
  p_expires_at timestamp with time zone
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.prepare_staff_invitation(
    p_invited_email,
    p_staff_role_id,
    p_reason,
    p_token_hash,
    p_expires_at
  );
$function$;

REVOKE ALL ON FUNCTION public.prepare_staff_invitation(text, uuid, text, text, timestamp with time zone) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.prepare_staff_invitation(text, uuid, text, text, timestamp with time zone) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
