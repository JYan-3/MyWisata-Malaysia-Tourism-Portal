-- Preserve the governed delivery callback and its idempotency checks.
ALTER FUNCTION public.finalize_staff_invitation_delivery(uuid, text, boolean) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.finalize_staff_invitation_delivery(uuid, text, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.finalize_staff_invitation_delivery(uuid, text, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.finalize_staff_invitation_delivery(
  p_invitation_id uuid,
  p_token_hash text,
  p_succeeded boolean
)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.finalize_staff_invitation_delivery(
    p_invitation_id,
    p_token_hash,
    p_succeeded
  );
$function$;

REVOKE ALL ON FUNCTION public.finalize_staff_invitation_delivery(uuid, text, boolean) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.finalize_staff_invitation_delivery(uuid, text, boolean) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
