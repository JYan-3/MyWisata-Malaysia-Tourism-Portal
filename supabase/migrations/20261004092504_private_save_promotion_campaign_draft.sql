-- Preserve the live campaign authorization, validation, and optimistic locking behavior.
ALTER FUNCTION public.save_promotion_campaign_draft(uuid, timestamp with time zone, text, text, text, text, timestamp with time zone, timestamp with time zone, text, text) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.save_promotion_campaign_draft(uuid, timestamp with time zone, text, text, text, text, timestamp with time zone, timestamp with time zone, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION app_private.save_promotion_campaign_draft(uuid, timestamp with time zone, text, text, text, text, timestamp with time zone, timestamp with time zone, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_promotion_campaign_draft(
  p_campaign_id uuid,
  p_expected_updated_at timestamp with time zone,
  p_title text,
  p_slug text,
  p_summary text,
  p_description text,
  p_starts_at timestamp with time zone,
  p_ends_at timestamp with time zone,
  p_poster_url text,
  p_operating_hours text
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.save_promotion_campaign_draft(
    p_campaign_id,
    p_expected_updated_at,
    p_title,
    p_slug,
    p_summary,
    p_description,
    p_starts_at,
    p_ends_at,
    p_poster_url,
    p_operating_hours
  );
$function$;

REVOKE ALL ON FUNCTION public.save_promotion_campaign_draft(uuid, timestamp with time zone, text, text, text, text, timestamp with time zone, timestamp with time zone, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.save_promotion_campaign_draft(uuid, timestamp with time zone, text, text, text, text, timestamp with time zone, timestamp with time zone, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
