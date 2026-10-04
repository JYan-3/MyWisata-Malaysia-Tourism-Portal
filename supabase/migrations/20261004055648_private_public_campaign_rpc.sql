-- Preserve the public campaign projection and optional slug contract while
-- moving the privileged implementation outside the exposed Data API schema.
ALTER FUNCTION public.get_public_promotion_campaigns(TEXT) SET SCHEMA app_private;

GRANT USAGE ON SCHEMA app_private TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION app_private.get_public_promotion_campaigns(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.get_public_promotion_campaigns(TEXT) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_public_promotion_campaigns(p_slug TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.get_public_promotion_campaigns(p_slug);
$function$;

REVOKE ALL ON FUNCTION public.get_public_promotion_campaigns(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_promotion_campaigns(TEXT) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
