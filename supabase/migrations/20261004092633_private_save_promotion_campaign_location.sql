-- Preserve live campaign location permission, validation, and event date boundaries.
ALTER FUNCTION public.save_promotion_campaign_location(uuid, uuid, text, text, double precision, double precision, date, date, time without time zone, time without time zone) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.save_promotion_campaign_location(uuid, uuid, text, text, double precision, double precision, date, date, time without time zone, time without time zone) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.save_promotion_campaign_location(uuid, uuid, text, text, double precision, double precision, date, date, time without time zone, time without time zone) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.save_promotion_campaign_location(
  p_campaign_id uuid,
  p_location_id uuid,
  p_name text,
  p_address text,
  p_lat double precision,
  p_lng double precision,
  p_starts_on date,
  p_ends_on date,
  p_opens_at time without time zone,
  p_closes_at time without time zone
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.save_promotion_campaign_location(
    p_campaign_id,
    p_location_id,
    p_name,
    p_address,
    p_lat,
    p_lng,
    p_starts_on,
    p_ends_on,
    p_opens_at,
    p_closes_at
  );
$function$;

REVOKE ALL ON FUNCTION public.save_promotion_campaign_location(uuid, uuid, text, text, double precision, double precision, date, date, time without time zone, time without time zone) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.save_promotion_campaign_location(uuid, uuid, text, text, double precision, double precision, date, date, time without time zone, time without time zone) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
