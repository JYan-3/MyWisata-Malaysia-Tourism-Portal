ALTER FUNCTION public.customer_affiliate_mode(uuid) SET SCHEMA app_private;
ALTER FUNCTION public.customer_can_submit_recommendation(uuid) SET SCHEMA app_private;
ALTER FUNCTION public.customer_is_active_email_verified(uuid) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.customer_affiliate_mode(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app_private.customer_can_submit_recommendation(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app_private.customer_is_active_email_verified(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.customer_affiliate_mode(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.customer_can_submit_recommendation(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.customer_is_active_email_verified(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.customer_affiliate_mode(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN auth.role() = 'service_role' THEN app_private.customer_affiliate_mode(p_user_id)
    WHEN auth.role() = 'authenticated' AND (p_user_id = auth.uid() OR public.is_admin(auth.uid())) THEN app_private.customer_affiliate_mode(p_user_id)
    ELSE 'none'
  END;
$function$;

CREATE OR REPLACE FUNCTION public.customer_can_submit_recommendation(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN auth.role() = 'service_role' THEN app_private.customer_can_submit_recommendation(p_user_id)
    WHEN auth.role() = 'authenticated' AND p_user_id = auth.uid() THEN app_private.customer_can_submit_recommendation(p_user_id)
    ELSE false
  END;
$function$;

CREATE OR REPLACE FUNCTION public.customer_is_active_email_verified(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN auth.role() = 'service_role' THEN app_private.customer_is_active_email_verified(p_user_id)
    WHEN auth.role() = 'authenticated' AND p_user_id = auth.uid() THEN app_private.customer_is_active_email_verified(p_user_id)
    ELSE false
  END;
$function$;

REVOKE ALL ON FUNCTION public.customer_affiliate_mode(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.customer_can_submit_recommendation(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.customer_is_active_email_verified(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.customer_affiliate_mode(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.customer_can_submit_recommendation(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.customer_is_active_email_verified(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
