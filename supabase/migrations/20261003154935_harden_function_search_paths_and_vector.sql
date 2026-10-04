-- Supabase's standard extension schema is not present in this project yet.
CREATE SCHEMA IF NOT EXISTS extensions AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA extensions FROM PUBLIC;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;

ALTER EXTENSION vector SET SCHEMA extensions;

-- Pin every function flagged by the Security Advisor to trusted schemas.
-- Keep the vector RPC explicit because its argument type moves with the extension.
ALTER FUNCTION public.match_kb_documents(extensions.vector, integer)
  SET search_path = public, extensions, pg_temp;

DO $function_paths$
DECLARE
  v_function RECORD;
BEGIN
  FOR v_function IN
    SELECT
      p.proname AS function_name,
      pg_get_function_identity_arguments(p.oid) AS identity_arguments
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (ARRAY[
        'set_updated_at',
        'normalize_vendor_name',
        'whoami',
        'recalculate_wallet_balance',
        'is_super_admin',
        'approve_withdrawal',
        'review_kyc',
        'convert_recommendation',
        'auto_upgrade_to_profile_complete',
        'request_withdrawal',
        'generate_product_display_id',
        'generate_outlet_display_id',
        'generate_order_display_id',
        'generate_booking_display_id',
        'cancel_withdrawal',
        'complete_withdrawal',
        'admin_set_processing',
        'record_admin_approval',
        'credit_pending_recommendation',
        'admin_reject_withdrawal',
        'round_sen',
        'tier_rank',
        'check_phone_collision',
        'derive_initial_user_tier',
        'admin_set_tier',
        'normalize_wallet_notification_category',
        'admin_conduct_flags_append_only',
        'touch_vendor_suggestions_updated_at'
      ])
  LOOP
    EXECUTE format(
      'ALTER FUNCTION public.%I(%s) SET search_path = public, extensions, pg_temp',
      v_function.function_name,
      v_function.identity_arguments
    );
  END LOOP;
END;
$function_paths$;
