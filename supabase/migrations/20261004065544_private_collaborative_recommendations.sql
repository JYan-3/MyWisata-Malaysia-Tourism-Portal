ALTER FUNCTION public.collaborative_recommendations(uuid, integer) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.collaborative_recommendations(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.collaborative_recommendations(uuid, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.collaborative_recommendations(
  p_user_id uuid,
  p_limit integer DEFAULT 20
)
RETURNS TABLE (
  product_id uuid,
  score numeric
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN QUERY
    SELECT *
      FROM app_private.collaborative_recommendations(p_user_id, p_limit);
END;
$function$;

REVOKE ALL ON FUNCTION public.collaborative_recommendations(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.collaborative_recommendations(uuid, integer) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
