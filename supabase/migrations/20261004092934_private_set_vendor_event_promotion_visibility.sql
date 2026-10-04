-- Preserve administrator-only pause/resume and concurrent-capacity controls for promotions.
ALTER FUNCTION public.set_vendor_event_promotion_visibility(uuid, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.set_vendor_event_promotion_visibility(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.set_vendor_event_promotion_visibility(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_vendor_event_promotion_visibility(
  p_promotion_id uuid,
  p_action text
)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.set_vendor_event_promotion_visibility(
    p_promotion_id,
    p_action
  );
$function$;

REVOKE ALL ON FUNCTION public.set_vendor_event_promotion_visibility(uuid, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.set_vendor_event_promotion_visibility(uuid, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
