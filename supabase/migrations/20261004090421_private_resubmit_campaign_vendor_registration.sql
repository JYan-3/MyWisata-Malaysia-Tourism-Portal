-- Preserve vendor ownership and campaign listing replacement on resubmission.
ALTER FUNCTION public.resubmit_campaign_vendor_registration(uuid, text, text, text, jsonb) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.resubmit_campaign_vendor_registration(uuid, text, text, text, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.resubmit_campaign_vendor_registration(uuid, text, text, text, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.resubmit_campaign_vendor_registration(
  p_registration_id uuid,
  p_stall_number text,
  p_stall_description text,
  p_stall_poster_url text,
  p_products jsonb
)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.resubmit_campaign_vendor_registration(
    p_registration_id,
    p_stall_number,
    p_stall_description,
    p_stall_poster_url,
    p_products
  );
$function$;

REVOKE ALL ON FUNCTION public.resubmit_campaign_vendor_registration(uuid, text, text, text, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.resubmit_campaign_vendor_registration(uuid, text, text, text, jsonb) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
