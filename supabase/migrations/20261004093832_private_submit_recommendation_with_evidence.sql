-- Preserve the live evidence-backed recommendation transaction and staged-image ownership checks.
ALTER FUNCTION public.submit_recommendation_with_evidence(text, text, text, uuid, text, text, text, double precision, double precision, text, text, text, uuid[]) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.submit_recommendation_with_evidence(text, text, text, uuid, text, text, text, double precision, double precision, text, text, text, uuid[]) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.submit_recommendation_with_evidence(text, text, text, uuid, text, text, text, double precision, double precision, text, text, text, uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.submit_recommendation_with_evidence(
  p_vendor_name text,
  p_description text,
  p_why_recommend text,
  p_category_id uuid,
  p_google_place_id text,
  p_location_name text,
  p_formatted_address text,
  p_latitude double precision,
  p_longitude double precision,
  p_contact_phone text,
  p_contact_email text,
  p_contact_website text,
  p_image_ids uuid[]
)
RETURNS uuid
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.submit_recommendation_with_evidence(
    p_vendor_name,
    p_description,
    p_why_recommend,
    p_category_id,
    p_google_place_id,
    p_location_name,
    p_formatted_address,
    p_latitude,
    p_longitude,
    p_contact_phone,
    p_contact_email,
    p_contact_website,
    p_image_ids
  );
$function$;

REVOKE ALL ON FUNCTION public.submit_recommendation_with_evidence(text, text, text, uuid, text, text, text, double precision, double precision, text, text, text, uuid[]) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.submit_recommendation_with_evidence(text, text, text, uuid, text, text, text, double precision, double precision, text, text, text, uuid[]) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
