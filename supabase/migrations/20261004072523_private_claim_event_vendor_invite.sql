ALTER FUNCTION public.claim_event_vendor_invite(text, text, text, text, text, text, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.claim_event_vendor_invite(text, text, text, text, text, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.claim_event_vendor_invite(text, text, text, text, text, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_event_vendor_invite(
  p_token_hash text,
  p_business_name text,
  p_legal_business_name text,
  p_description text,
  p_contact_email text,
  p_contact_phone text,
  p_business_address text
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.claim_event_vendor_invite(
    p_token_hash,
    p_business_name,
    p_legal_business_name,
    p_description,
    p_contact_email,
    p_contact_phone,
    p_business_address
  );
$function$;

REVOKE ALL ON FUNCTION public.claim_event_vendor_invite(text, text, text, text, text, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.claim_event_vendor_invite(text, text, text, text, text, text, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
