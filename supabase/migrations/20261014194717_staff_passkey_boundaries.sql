-- Add assurance at the existing elevated-authority branches. Preserve their
-- original OIDs, pure bootstrap queries, owner branches and service jobs.
DO $$
DECLARE f record; v_body text;
BEGIN
  FOR f IN SELECT p.oid,p.prosrc,l.lanname FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
    WHERE n.nspname='app_private' AND p.proname IN ('is_admin','is_super_admin','is_approver',
      'can_review_recommendation','is_active_global_staff_super_admin','is_kyc_review_super_admin','has_staff_permission')
  LOOP
    IF f.lanname='sql' THEN
      v_body := 'SELECT app_private.staff_authority_assurance() AND (' || regexp_replace(btrim(f.prosrc),';\s*$','') || ');';
    ELSIF f.lanname='plpgsql' THEN
      IF f.prosrc !~* '\mBEGIN\M' THEN RAISE EXCEPTION 'unsupported_staff_helper'; END IF;
      v_body := regexp_replace(f.prosrc,'\mBEGIN\M',
        'BEGIN IF NOT app_private.staff_authority_assurance() THEN RETURN FALSE; END IF;','i');
    ELSE RAISE EXCEPTION 'unsupported_staff_helper'; END IF;
    EXECUTE replace(pg_get_functiondef(f.oid),f.prosrc,v_body);
  END LOOP;
END $$;

-- Older staff-governance functions contain their own raw role checks rather
-- than calling the shared helpers. Enforce the same caller assurance there.
DO $$ DECLARE f record; v_body text; BEGIN
  FOR f IN SELECT p.oid,p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname IN ('public','app_private') AND l.lanname='plpgsql'
    AND p.proname IN ('require_active_global_staff_super_admin','assign_staff_role','create_staff_role',
      'create_staff_role_with_modules','prepare_staff_invitation','prepare_staff_invitation_resend',
      'revoke_staff_role_assignment','update_staff_role','update_staff_role_with_modules')
  LOOP
    IF f.prosrc !~* '\mBEGIN\M' THEN RAISE EXCEPTION 'unsupported_staff_governance'; END IF;
    v_body:=regexp_replace(f.prosrc,'\mBEGIN\M',
      'BEGIN IF NOT app_private.staff_authority_assurance() THEN RAISE EXCEPTION ''staff_passkey_required''; END IF;','i');
    EXECUTE replace(pg_get_functiondef(f.oid),f.prosrc,v_body);
  END LOOP;
END $$;

-- Payout retry uses the same active/unscoped delegated permission as approval.
DO $$ DECLARE v_oid oid; v_source text; BEGIN
  v_oid:='public.record_withdrawal_payout_retry(uuid,uuid,text,inet,text)'::regprocedure;
  SELECT prosrc INTO v_source FROM pg_proc WHERE oid=v_oid;
  IF position('NOT public.is_approver(p_actor_id)' in v_source)=0 THEN RAISE EXCEPTION 'unexpected_retry_authority'; END IF;
  EXECUTE replace(pg_get_functiondef(v_oid),v_source,
    replace(v_source,'NOT public.is_approver(p_actor_id)',
      'NOT public.has_staff_permission(p_actor_id,''admin.withdrawal.approve'')'));
END $$;

-- Legacy and unbound approval entrypoints cannot remain alternate APIs.
REVOKE EXECUTE ON FUNCTION public.approve_wallet_withdrawal(uuid,text,inet,text) FROM authenticated,anon,PUBLIC;
REVOKE EXECUTE ON FUNCTION app_private.approve_wallet_withdrawal(uuid,text,inet,text) FROM authenticated,anon,PUBLIC;
REVOKE EXECUTE ON FUNCTION public.override_withdrawal_risk(uuid,text,inet) FROM authenticated,anon,PUBLIC;
REVOKE EXECUTE ON FUNCTION app_private.override_withdrawal_risk(uuid,text,inet) FROM authenticated,anon,PUBLIC;
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('public','app_private') AND p.proname IN ('approve_withdrawal','record_admin_approval')
  LOOP EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature); END LOOP;
END $$;

CREATE FUNCTION public.authorize_staff_withdrawal_action(p_withdrawal_id uuid,p_action text,p_payload jsonb,p_proof_id uuid,
  p_ip inet DEFAULT NULL,p_actor_id uuid DEFAULT NULL,p_session_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid; v_session uuid; v_binding jsonb; v_proof app_private.withdrawal_authorization_proofs%ROWTYPE; v_result jsonb;
BEGIN
  IF auth.role()='authenticated' THEN
    v_actor:=auth.uid(); v_session:=NULLIF(auth.jwt()->>'session_id','')::uuid;
    IF p_actor_id IS NOT NULL OR p_session_id IS NOT NULL THEN RAISE EXCEPTION 'actor_override_forbidden'; END IF;
  ELSIF auth.role()='service_role' AND p_action='retry-payout' THEN
    v_actor:=p_actor_id; v_session:=p_session_id;
  ELSE RAISE EXCEPTION 'authenticated_actor_required'; END IF;
  IF NOT app_private.staff_session_verified(v_actor,v_session) THEN RAISE EXCEPTION 'staff_passkey_required'; END IF;
  -- Locks the request before checking the immutable financial snapshot.
  v_binding:=app_private.staff_withdrawal_binding(v_actor,p_action,p_withdrawal_id,p_payload);
  SELECT * INTO v_proof FROM app_private.withdrawal_authorization_proofs
    WHERE id=p_proof_id AND user_id=v_actor AND session_id=v_session AND expires_at>now() AND consumed_at IS NULL FOR UPDATE;
  IF NOT FOUND OR v_proof.binding IS DISTINCT FROM v_binding OR NOT EXISTS (
    SELECT 1 FROM app_private.staff_passkey_credentials WHERE credential_id=v_proof.credential_id
      AND user_id=v_actor AND revoked_at IS NULL) THEN RAISE EXCEPTION 'proof_required'; END IF;
  UPDATE app_private.withdrawal_authorization_proofs SET consumed_at=now() WHERE id=v_proof.id;
  IF p_action='approve' THEN
    v_result:=app_private.approve_wallet_withdrawal(p_withdrawal_id,p_payload->>'note',p_ip,p_payload->>'reasonCategory');
  ELSIF p_action='fraud-override' THEN
    v_result:=app_private.override_withdrawal_risk(p_withdrawal_id,p_payload->>'reason',p_ip);
  ELSIF p_action='retry-payout' AND auth.role()='service_role' THEN
    v_result:=public.record_withdrawal_payout_retry(p_withdrawal_id,v_actor,p_payload->>'note',p_ip,p_payload->>'reasonCategory');
  ELSE RAISE EXCEPTION 'invalid_action'; END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.authorize_staff_withdrawal_action(uuid,text,jsonb,uuid,inet,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.authorize_staff_withdrawal_action(uuid,text,jsonb,uuid,inet,uuid,uuid) TO authenticated,service_role;
NOTIFY pgrst,'reload schema';
