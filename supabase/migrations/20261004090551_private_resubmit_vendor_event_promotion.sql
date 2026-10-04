-- Preserve event promotion vendor ownership and resubmission review state.
ALTER FUNCTION public.resubmit_vendor_event_promotion(uuid, text, text, date, date, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.resubmit_vendor_event_promotion(uuid, text, text, date, date, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.resubmit_vendor_event_promotion(uuid, text, text, date, date, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.resubmit_vendor_event_promotion(
  p_promotion_id uuid,
  p_title text,
  p_details text,
  p_starts_on date,
  p_ends_on date,
  p_poster_url text
)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.resubmit_vendor_event_promotion(
    p_promotion_id,
    p_title,
    p_details,
    p_starts_on,
    p_ends_on,
    p_poster_url
  );
$function$;

REVOKE ALL ON FUNCTION public.resubmit_vendor_event_promotion(uuid, text, text, date, date, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.resubmit_vendor_event_promotion(uuid, text, text, date, date, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
