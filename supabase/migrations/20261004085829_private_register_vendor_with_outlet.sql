-- Preserve vendor registration and gallery validation behind an invoker API.
ALTER FUNCTION public.register_vendor_with_outlet(text, text, text, text, text, text, text, text, text, text, text, text, jsonb) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.register_vendor_with_outlet(text, text, text, text, text, text, text, text, text, text, text, text, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.register_vendor_with_outlet(text, text, text, text, text, text, text, text, text, text, text, text, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.register_vendor_with_outlet(
  p_name text,
  p_slug text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_business_type text DEFAULT NULL,
  p_legal_business_name text DEFAULT NULL,
  p_registration_number text DEFAULT NULL,
  p_contact_name text DEFAULT NULL,
  p_contact_email text DEFAULT NULL,
  p_contact_phone text DEFAULT NULL,
  p_business_address text DEFAULT NULL,
  p_logo_url text DEFAULT NULL,
  p_cover_url text DEFAULT NULL,
  p_gallery jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.register_vendor_with_outlet(
    p_name,
    p_slug,
    p_description,
    p_business_type,
    p_legal_business_name,
    p_registration_number,
    p_contact_name,
    p_contact_email,
    p_contact_phone,
    p_business_address,
    p_logo_url,
    p_cover_url,
    p_gallery
  );
$function$;

REVOKE ALL ON FUNCTION public.register_vendor_with_outlet(text, text, text, text, text, text, text, text, text, text, text, text, jsonb) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.register_vendor_with_outlet(text, text, text, text, text, text, text, text, text, text, text, text, jsonb) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
