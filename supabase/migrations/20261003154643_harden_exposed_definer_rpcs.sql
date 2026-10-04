-- Keep SECURITY DEFINER execution limited to the roles used by current callers.
-- Restore existing authenticated/service_role access explicitly so removing
-- the default PUBLIC grant does not change those routes.
DO $migration$
DECLARE
  v_function RECORD;
  v_allow_anon BOOLEAN;
BEGIN
  FOR v_function IN
    SELECT
      p.oid,
      p.oid::regprocedure::text AS signature,
      p.proname AS function_name,
      p.prorettype = 'trigger'::regtype AS is_trigger,
      has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_exec,
      has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_exec
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
  LOOP
    v_allow_anon := v_function.function_name IN (
      'get_event_pickup_availability',
      'get_public_promotion_campaigns',
      'list_active_sponsored_discovery_placements',
      'record_sponsored_discovery_event'
    ) OR EXISTS (
      SELECT 1
      FROM pg_depend AS dependency
      JOIN pg_policy AS policy ON policy.oid = dependency.objid
      WHERE dependency.classid = 'pg_policy'::regclass
        AND dependency.refclassid = 'pg_proc'::regclass
        AND dependency.refobjid = v_function.oid
        AND (
          cardinality(policy.polroles) = 0
          OR 0 = ANY (policy.polroles)
          OR 'anon'::regrole::oid = ANY (policy.polroles)
        )
    );

    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',
      v_function.signature
    );

    IF NOT v_function.is_trigger AND v_function.authenticated_exec THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_function.signature);
    END IF;

    IF NOT v_function.is_trigger AND v_function.service_role_exec THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_function.signature);
    END IF;

    IF NOT v_function.is_trigger AND v_allow_anon AND v_function.anon_exec THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', v_function.signature);
    END IF;
  END LOOP;

  -- Trigger handlers are invoked by PostgreSQL, not by PostgREST. Their
  -- execute privilege was checked when the existing triggers were created.
  FOR v_function IN
    SELECT p.oid::regprocedure::text AS signature
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prorettype = 'trigger'::regtype
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',
      v_function.signature
    );
  END LOOP;
END;
$migration$;

-- These helpers must remain executable by anon because public RLS policies
-- call them. Prevent direct anonymous RPC calls from probing other users.
CREATE OR REPLACE FUNCTION public.is_admin(uid UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT CASE
    WHEN auth.role() = 'anon' THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.user_roles AS assignment
      JOIN public.roles AS role_row ON role_row.id = assignment.role_id
      WHERE assignment.user_id = uid
        AND role_row.name IN ('super_admin', 'approver')
    )
  END;
$function$;

CREATE OR REPLACE FUNCTION public.is_super_admin(uid UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT CASE
    WHEN auth.role() = 'anon' THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.user_roles AS assignment
      JOIN public.roles AS role_row ON role_row.id = assignment.role_id
      WHERE assignment.user_id = uid
        AND role_row.name = 'super_admin'
    )
  END;
$function$;

CREATE OR REPLACE FUNCTION public.order_has_vendor_item(p_order_id UUID, p_uid UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT CASE
    WHEN auth.role() = 'anon' THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.order_items AS order_item
      JOIN public.vendors AS vendor ON vendor.id = order_item.vendor_id
      WHERE order_item.order_id = p_order_id
        AND vendor.owner_id = p_uid
    )
  END;
$function$;

CREATE OR REPLACE FUNCTION public.order_owned_by(p_order_id UUID, p_uid UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT CASE
    WHEN auth.role() = 'anon' THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.orders AS order_row
      WHERE order_row.id = p_order_id
        AND order_row.user_id = p_uid
    )
  END;
$function$;

-- These functions are called only by trusted server/database code. Preserve
-- the existing business logic and its server-side callers.
REVOKE ALL ON FUNCTION public.apply_external_reservation(UUID, TEXT, UUID, INT, TEXT, TEXT, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_external_reservation(UUID, TEXT, UUID, INT, TEXT, TEXT, TEXT, JSONB)
  TO service_role;

REVOKE ALL ON FUNCTION public.credit_pending_recommendation(UUID, BIGINT, TEXT, UUID, UUID, NUMERIC, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_pending_recommendation(UUID, BIGINT, TEXT, UUID, UUID, NUMERIC, TEXT)
  TO service_role;

REVOKE ALL ON FUNCTION public.record_withdrawal_payout_failure(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_withdrawal_payout_failure(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN)
  TO service_role;

REVOKE ALL ON FUNCTION public.mark_withdrawal_processing(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_withdrawal_processing(UUID, TEXT, TEXT)
  TO service_role;

REVOKE ALL ON FUNCTION public.record_withdrawal_payout_fee(UUID, BIGINT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_withdrawal_payout_fee(UUID, BIGINT)
  TO service_role;

-- Legacy direct ledger mutators have no current application/service caller.
-- admin_reject_withdrawal reaches cancel_withdrawal as the function owner.
REVOKE ALL ON FUNCTION public.cancel_withdrawal(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_withdrawal(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;

-- The merge map is migration metadata and has no application caller.
ALTER TABLE public.product_merge_map ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.product_merge_map FROM PUBLIC, anon, authenticated;
DO $policy$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'product_merge_map'
      AND policyname = 'security_advisor_deny_client_access'
  ) THEN
    EXECUTE 'CREATE POLICY security_advisor_deny_client_access
      ON public.product_merge_map
      FOR ALL TO anon, authenticated
      USING (false)
      WITH CHECK (false)';
  END IF;
END;
$policy$;

-- These RLS tables are intentionally private. False client policies preserve
-- the existing default-deny behavior while making that boundary explicit.
DO $policies$
DECLARE
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'capabilities',
    'content_translation_generation_locks',
    'entitlement_assignments',
    'entitlement_generation',
    'entitlement_policies',
    'entitlement_policy_approvals',
    'entitlement_policy_requirements',
    'entitlement_policy_versions',
    'geocode_cache',
    'kyc_ocr_results',
    'kyc_review_events',
    'kyc_submission_documents',
    'location_cities',
    'payout_provider_events',
    'payout_transactions',
    'platform_settings',
    'promotion_campaign_vendor_review_events',
    'recommendation_review_events',
    'recommendation_snapshots',
    'sponsored_discovery_events',
    'staff_invitations',
    'sync_outbox',
    'tng_mock_callback_outbox',
    'vendor_event_promotion_review_events',
    'voucher_store_redemptions'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = v_table
        AND policyname = 'security_advisor_deny_client_access'
    ) THEN
      EXECUTE format(
        'CREATE POLICY security_advisor_deny_client_access ON public.%I FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)',
        v_table
      );
    END IF;
  END LOOP;
END;
$policies$;
