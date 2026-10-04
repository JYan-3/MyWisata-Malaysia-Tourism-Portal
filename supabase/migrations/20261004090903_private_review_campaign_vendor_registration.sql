-- Preserve privileged review actions for campaign vendor registrations.
ALTER FUNCTION public.review_campaign_vendor_registration(uuid, text, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.review_campaign_vendor_registration(uuid, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.review_campaign_vendor_registration(uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.review_campaign_vendor_registration(
  p_registration_id uuid,
  p_action text,
  p_note text DEFAULT NULL
)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.review_campaign_vendor_registration(
    p_registration_id,
    p_action,
    p_note
  );
$function$;

REVOKE ALL ON FUNCTION public.review_campaign_vendor_registration(uuid, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.review_campaign_vendor_registration(uuid, text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
