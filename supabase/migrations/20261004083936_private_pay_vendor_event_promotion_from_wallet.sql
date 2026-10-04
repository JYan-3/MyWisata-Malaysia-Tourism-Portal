-- Preserve the authenticated vendor payment transaction and ownership checks.
ALTER FUNCTION public.pay_vendor_event_promotion_from_wallet(uuid) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.pay_vendor_event_promotion_from_wallet(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.pay_vendor_event_promotion_from_wallet(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pay_vendor_event_promotion_from_wallet(
  p_promotion_id uuid
)
RETURNS bigint
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.pay_vendor_event_promotion_from_wallet(
    p_promotion_id
  );
$function$;

REVOKE ALL ON FUNCTION public.pay_vendor_event_promotion_from_wallet(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.pay_vendor_event_promotion_from_wallet(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
