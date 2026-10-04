ALTER FUNCTION public.claim_vendor_recommendation(text, text, text, text, uuid, text, text, text, text, double precision, double precision) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.claim_vendor_recommendation(text, text, text, text, uuid, text, text, text, text, double precision, double precision) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.claim_vendor_recommendation(text, text, text, text, uuid, text, text, text, text, double precision, double precision) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_vendor_recommendation(
  p_token_hash text,
  p_business_name text,
  p_legal_business_name text,
  p_description text,
  p_category_id uuid,
  p_outlet_name text,
  p_contact_email text,
  p_contact_phone text,
  p_business_address text,
  p_latitude double precision,
  p_longitude double precision
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.claim_vendor_recommendation(
    p_token_hash,
    p_business_name,
    p_legal_business_name,
    p_description,
    p_category_id,
    p_outlet_name,
    p_contact_email,
    p_contact_phone,
    p_business_address,
    p_latitude,
    p_longitude
  );
$function$;

REVOKE ALL ON FUNCTION public.claim_vendor_recommendation(text, text, text, text, uuid, text, text, text, text, double precision, double precision) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.claim_vendor_recommendation(text, text, text, text, uuid, text, text, text, text, double precision, double precision) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
