ALTER FUNCTION public.get_withdrawal_review_sources(uuid, integer, integer) SET SCHEMA app_private;
ALTER FUNCTION public.get_withdrawal_settlement_proof(uuid) SET SCHEMA app_private;

REVOKE ALL ON FUNCTION app_private.get_withdrawal_review_sources(uuid, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app_private.get_withdrawal_settlement_proof(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.get_withdrawal_review_sources(uuid, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.get_withdrawal_settlement_proof(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_withdrawal_review_sources(p_withdrawal_id uuid, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
  SELECT app_private.get_withdrawal_review_sources(p_withdrawal_id, p_limit, p_offset);
$function$;

CREATE OR REPLACE FUNCTION public.get_withdrawal_settlement_proof(p_withdrawal_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.get_withdrawal_settlement_proof(p_withdrawal_id);
$function$;

REVOKE ALL ON FUNCTION public.get_withdrawal_review_sources(uuid, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_withdrawal_settlement_proof(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_withdrawal_review_sources(uuid, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_withdrawal_settlement_proof(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
