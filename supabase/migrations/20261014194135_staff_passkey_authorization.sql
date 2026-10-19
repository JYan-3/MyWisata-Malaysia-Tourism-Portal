-- Application-owned WebAuthn trust. Apply with the compatible app and supervised
-- enrollment process. This migration deliberately enforces staff verification.
CREATE TABLE app_private.staff_passkey_credentials (
  credential_id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_handle text NOT NULL,
  public_key text NOT NULL,
  counter bigint NOT NULL CHECK (counter >= 0),
  transports jsonb NOT NULL DEFAULT '[]',
  device_type text NOT NULL CHECK (device_type IN ('singleDevice','multiDevice')),
  backed_up boolean NOT NULL,
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX ON app_private.staff_passkey_credentials(user_id) WHERE revoked_at IS NULL;
CREATE TABLE app_private.staff_passkey_enrollment_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash text UNIQUE NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 10 AND 500),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE TABLE app_private.staff_passkey_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES auth.sessions(id) ON DELETE CASCADE,
  operation text NOT NULL CHECK (operation IN ('register','login','approve','retry-payout','fraud-override','manage')),
  challenge text NOT NULL,
  user_handle text NOT NULL,
  binding jsonb NOT NULL DEFAULT '{}',
  label text NOT NULL DEFAULT 'Passkey',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + INTERVAL '2 minutes',
  consumed_at timestamptz,
  reservation_token uuid,
  finalized_at timestamptz
);
CREATE INDEX ON app_private.staff_passkey_challenges(user_id, created_at);
CREATE TABLE app_private.staff_session_assurance (
  session_id uuid PRIMARY KEY REFERENCES auth.sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credential_id text NOT NULL REFERENCES app_private.staff_passkey_credentials(credential_id),
  verified_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + INTERVAL '12 hours'
);
CREATE TABLE app_private.withdrawal_authorization_proofs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES auth.sessions(id) ON DELETE CASCADE,
  credential_id text NOT NULL REFERENCES app_private.staff_passkey_credentials(credential_id),
  binding jsonb NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now() + INTERVAL '2 minutes',
  consumed_at timestamptz
);
ALTER TABLE app_private.staff_passkey_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.staff_passkey_enrollment_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.staff_passkey_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.staff_session_assurance ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.withdrawal_authorization_proofs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app_private.staff_passkey_credentials, app_private.staff_passkey_enrollment_grants,
  app_private.staff_passkey_challenges, app_private.staff_session_assurance, app_private.withdrawal_authorization_proofs
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION app_private.staff_passkey_account(p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.users u JOIN public.user_roles ur ON ur.user_id = u.id
    JOIN public.roles r ON r.id = ur.role_id WHERE u.id = p_user_id AND u.status = 'active'
    AND ur.vendor_id IS NULL AND ur.outlet_id IS NULL AND r.name IN ('admin','approver','super_admin','staff'));
$$;
CREATE FUNCTION app_private.staff_password_session(p_user_id uuid, p_session_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT app_private.staff_passkey_account(p_user_id) AND EXISTS (
    SELECT 1 FROM auth.sessions s JOIN auth.mfa_amr_claims m ON m.session_id = s.id
    WHERE s.id = p_session_id AND s.user_id = p_user_id AND (s.not_after IS NULL OR s.not_after > now())
    AND m.authentication_method = 'password' AND NOT EXISTS (
      SELECT 1 FROM auth.mfa_amr_claims other WHERE other.session_id = s.id
      AND other.authentication_method IN ('oauth','otp','recovery','invite','magiclink','passkey','sso/saml','anonymous')
      AND other.updated_at >= m.updated_at));
$$;
CREATE FUNCTION app_private.staff_session_verified(p_user_id uuid, p_session_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT app_private.staff_password_session(p_user_id,p_session_id) AND EXISTS (
    SELECT 1 FROM app_private.staff_session_assurance a
    JOIN app_private.staff_passkey_credentials c ON c.credential_id = a.credential_id AND c.user_id = a.user_id
    JOIN auth.mfa_amr_claims m ON m.session_id = a.session_id AND m.authentication_method = 'password'
    WHERE a.user_id = p_user_id AND a.session_id = p_session_id AND a.expires_at > now()
    AND c.revoked_at IS NULL AND a.verified_at >= m.updated_at);
$$;
-- Only elevated authenticated branches need assurance. Trusted service jobs and
-- bootstrap role discovery retain their existing authority semantics.
CREATE FUNCTION app_private.staff_authority_assurance() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN auth.role() = 'authenticated' THEN
    app_private.staff_session_verified(auth.uid(), NULLIF(auth.jwt()->>'session_id','')::uuid)
    ELSE true END;
$$;
CREATE FUNCTION public.staff_passkey_status() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('required',app_private.staff_passkey_account(auth.uid()),
    'passwordAuthenticated',app_private.staff_password_session(auth.uid(),NULLIF(auth.jwt()->>'session_id','')::uuid),
    'verified',app_private.staff_session_verified(auth.uid(),NULLIF(auth.jwt()->>'session_id','')::uuid));
$$;
CREATE FUNCTION app_private.staff_passkey_service() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
END;
$$;
CREATE FUNCTION public.staff_passkey_credentials(p_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.staff_passkey_service();
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.credential_id,'label',c.label,
    'publicKey',c.public_key,'counter',c.counter,'transports',c.transports,'userHandle',c.user_handle))
    FROM app_private.staff_passkey_credentials c WHERE c.user_id=p_user_id AND c.revoked_at IS NULL),'[]');
END;
$$;
CREATE FUNCTION public.issue_staff_passkey_enrollment_grant(p_user_id uuid,p_token_hash text,p_reason text,p_recovery boolean DEFAULT false) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM app_private.staff_passkey_service();
  IF NOT app_private.staff_passkey_account(p_user_id) THEN RAISE EXCEPTION 'staff_account_required'; END IF;
  PERFORM 1 FROM auth.users WHERE id=p_user_id FOR UPDATE;
  -- A recovery operator explicitly revokes old credentials and their assurance.
  IF p_recovery THEN
    UPDATE app_private.staff_passkey_credentials SET revoked_at=now() WHERE user_id=p_user_id AND revoked_at IS NULL;
    DELETE FROM app_private.staff_session_assurance WHERE user_id=p_user_id;
    DELETE FROM app_private.staff_passkey_challenges WHERE user_id=p_user_id;
    UPDATE app_private.withdrawal_authorization_proofs SET consumed_at=now() WHERE user_id=p_user_id AND consumed_at IS NULL;
  END IF;
  UPDATE app_private.staff_passkey_enrollment_grants SET consumed_at=now() WHERE user_id=p_user_id AND consumed_at IS NULL;
  INSERT INTO app_private.staff_passkey_enrollment_grants(user_id,token_hash,reason,expires_at)
    VALUES(p_user_id,p_token_hash,p_reason,now()+INTERVAL '15 minutes') RETURNING id INTO v_id;
  INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,note)
    VALUES(NULL,CASE WHEN p_recovery THEN 'staff.passkey_recovery_grant' ELSE 'staff.passkey_enrollment_grant' END,'user',p_user_id,p_reason);
  RETURN v_id;
END;
$$;
CREATE FUNCTION app_private.staff_withdrawal_snapshot(p_withdrawal_id uuid) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('withdrawalId',w.id,'approvalCycle',w.approval_cycle,'amount',w.amount,
    'recipient',w.user_id,'destinationId',w.destination_id,'destinationProvider',w.destination_provider,
    'destinationReference',w.destination_provider_reference,'destinationLabel',w.destination_label,
    'destinationMaskedRef',w.destination_masked_ref,'payoutProvider',w.payout_provider,'status',w.status)
  FROM public.withdrawal_requests w WHERE id=p_withdrawal_id FOR UPDATE;
$$;
CREATE FUNCTION public.staff_withdrawal_authorization_version(p_withdrawal_id uuid,p_expected_record jsonb) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_snapshot jsonb;
BEGIN
  IF NOT app_private.staff_session_verified(auth.uid(),NULLIF(auth.jwt()->>'session_id','')::uuid)
    OR NOT public.has_staff_permission(auth.uid(),'admin.withdrawal.approve') THEN RAISE EXCEPTION 'staff_passkey_required'; END IF;
  v_snapshot:=app_private.staff_withdrawal_snapshot(p_withdrawal_id);
  -- Verify the fields used by the actual rendered review, not an unrelated
  -- second read which could attach a new version to an older displayed amount.
  IF v_snapshot IS NULL OR p_expected_record IS DISTINCT FROM jsonb_build_object(
    'amountSen',round((v_snapshot->>'amount')::numeric*100),'userId',v_snapshot->'recipient',
    'status',v_snapshot->'status','destinationLabel',v_snapshot->'destinationLabel',
    'destinationProvider',v_snapshot->'destinationProvider','destinationMaskedRef',v_snapshot->'destinationMaskedRef',
    'payoutProvider',v_snapshot->'payoutProvider') THEN RAISE EXCEPTION 'withdrawal_changed'; END IF;
  RETURN md5(v_snapshot::text);
END;
$$;
CREATE FUNCTION app_private.staff_withdrawal_binding(p_user_id uuid,p_action text,p_withdrawal_id uuid,p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE w public.withdrawal_requests%ROWTYPE;
BEGIN
  SELECT * INTO w FROM public.withdrawal_requests WHERE id=p_withdrawal_id FOR UPDATE;
  IF NOT FOUND OR w.user_id=p_user_id THEN RAISE EXCEPTION 'withdrawal_not_authorizable'; END IF;
  IF p_action NOT IN ('approve','retry-payout','fraud-override') THEN RAISE EXCEPTION 'invalid_action'; END IF;
  IF (p_action='approve' AND w.status NOT IN ('pending','pending_second_approval'))
    OR (p_action='retry-payout' AND w.status<>'approved')
    OR (p_action='fraud-override' AND w.status NOT IN ('pending','pending_second_approval','approved','hold','overdue')) THEN RAISE EXCEPTION 'withdrawal_not_authorizable'; END IF;
  IF p_action='fraud-override' THEN
    IF NOT public.is_super_admin(p_user_id) THEN RAISE EXCEPTION 'super_admin_required'; END IF;
  ELSIF NOT public.has_staff_permission(p_user_id,'admin.withdrawal.approve') THEN RAISE EXCEPTION 'withdrawal_permission_required'; END IF;
  RETURN app_private.staff_withdrawal_snapshot(p_withdrawal_id)||jsonb_build_object('action',p_action,'payload',p_payload);
END;
$$;
CREATE FUNCTION public.begin_staff_passkey_challenge(p_user_id uuid,p_session_id uuid,p_operation text,p_challenge text,
  p_user_handle text,p_label text DEFAULT 'Passkey',p_withdrawal_id uuid DEFAULT NULL,p_payload jsonb DEFAULT '{}',p_grant_hash text DEFAULT NULL,p_expected_version text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid; v_binding jsonb := '{}'; v_handle text; v_grant uuid;
BEGIN
  PERFORM app_private.staff_passkey_service();
  IF NOT app_private.staff_password_session(p_user_id,p_session_id) THEN RAISE EXCEPTION 'password_session_required'; END IF;
  -- Serialize creation to make short-window limits atomic, not a racy count.
  PERFORM 1 FROM auth.users WHERE id=p_user_id FOR UPDATE;
  DELETE FROM app_private.staff_passkey_challenges WHERE user_id=p_user_id AND created_at<now()-INTERVAL '1 day';
  DELETE FROM app_private.withdrawal_authorization_proofs WHERE user_id=p_user_id AND expires_at<now()-INTERVAL '1 day';
  DELETE FROM app_private.staff_passkey_enrollment_grants WHERE user_id=p_user_id AND expires_at<now()-INTERVAL '1 day';
  IF (SELECT count(*) FROM app_private.staff_passkey_challenges WHERE user_id=p_user_id AND created_at>now()-INTERVAL '5 minutes')>=10 THEN RAISE EXCEPTION 'passkey_rate_limited'; END IF;
  SELECT user_handle INTO v_handle FROM app_private.staff_passkey_credentials WHERE user_id=p_user_id AND revoked_at IS NULL LIMIT 1;
  v_handle := COALESCE(v_handle,p_user_handle);
  IF p_operation='register' THEN
    IF NOT EXISTS (SELECT 1 FROM app_private.staff_session_assurance a WHERE a.user_id=p_user_id AND a.session_id=p_session_id
      AND a.verified_at>now()-INTERVAL '5 minutes' AND app_private.staff_session_verified(p_user_id,p_session_id)) THEN
      SELECT id INTO v_grant FROM app_private.staff_passkey_enrollment_grants WHERE user_id=p_user_id AND token_hash=p_grant_hash
        AND expires_at>now() AND consumed_at IS NULL FOR UPDATE;
      IF v_grant IS NULL THEN RAISE EXCEPTION 'enrollment_grant_required'; END IF;
      UPDATE app_private.staff_passkey_enrollment_grants SET consumed_at=now() WHERE id=v_grant;
    END IF;
    IF (SELECT count(*) FROM app_private.staff_passkey_credentials WHERE user_id=p_user_id AND revoked_at IS NULL)>=5 THEN RAISE EXCEPTION 'too_many_credentials'; END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM app_private.staff_passkey_credentials WHERE user_id=p_user_id AND revoked_at IS NULL) THEN RAISE EXCEPTION 'enrollment_required'; END IF;
    IF p_operation IN ('approve','retry-payout','fraud-override') THEN
      IF NOT app_private.staff_session_verified(p_user_id,p_session_id) THEN RAISE EXCEPTION 'staff_passkey_required'; END IF;
      v_binding := app_private.staff_withdrawal_binding(p_user_id,p_operation,p_withdrawal_id,p_payload);
      IF p_expected_version IS DISTINCT FROM md5((v_binding-'action'-'payload')::text) THEN RAISE EXCEPTION 'withdrawal_changed'; END IF;
    ELSIF p_operation NOT IN ('login','manage') THEN RAISE EXCEPTION 'invalid_operation'; END IF;
  END IF;
  INSERT INTO app_private.staff_passkey_challenges(user_id,session_id,operation,challenge,user_handle,binding,label)
    VALUES(p_user_id,p_session_id,p_operation,p_challenge,v_handle,v_binding,p_label) RETURNING id INTO v_id;
  RETURN jsonb_build_object('id',v_id,'userHandle',v_handle);
END;
$$;
CREATE FUNCTION public.claim_staff_passkey_challenge(p_user_id uuid,p_session_id uuid,p_challenge_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c app_private.staff_passkey_challenges%ROWTYPE;
BEGIN
  PERFORM app_private.staff_passkey_service();
  IF NOT app_private.staff_password_session(p_user_id,p_session_id) THEN RAISE EXCEPTION 'password_session_required'; END IF;
  UPDATE app_private.staff_passkey_challenges SET consumed_at=now(),reservation_token=gen_random_uuid()
    WHERE id=p_challenge_id AND user_id=p_user_id AND session_id=p_session_id AND expires_at>now()
    AND consumed_at IS NULL RETURNING * INTO c;
  IF NOT FOUND THEN RAISE EXCEPTION 'challenge_unavailable'; END IF;
  RETURN to_jsonb(c);
END;
$$;
CREATE FUNCTION public.finish_staff_passkey_challenge(p_user_id uuid,p_session_id uuid,p_challenge_id uuid,p_reservation_token uuid,
  p_credential_id text,p_public_key text,p_counter bigint,p_previous_counter bigint,p_transports jsonb,p_device_type text,p_backed_up boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE c app_private.staff_passkey_challenges%ROWTYPE; v_proof uuid;
BEGIN
  PERFORM app_private.staff_passkey_service();
  PERFORM 1 FROM auth.users WHERE id=p_user_id FOR UPDATE;
  IF NOT app_private.staff_password_session(p_user_id,p_session_id) THEN RAISE EXCEPTION 'password_session_required'; END IF;
  SELECT * INTO c FROM app_private.staff_passkey_challenges WHERE id=p_challenge_id AND user_id=p_user_id AND session_id=p_session_id
    AND reservation_token=p_reservation_token AND consumed_at IS NOT NULL AND expires_at>now() AND finalized_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'challenge_unavailable'; END IF;
  IF c.operation='register' THEN
    IF (SELECT count(*) FROM app_private.staff_passkey_credentials WHERE user_id=p_user_id AND revoked_at IS NULL)>=5 THEN RAISE EXCEPTION 'too_many_credentials'; END IF;
    INSERT INTO app_private.staff_passkey_credentials(credential_id,user_id,user_handle,public_key,counter,transports,device_type,backed_up,label)
      VALUES(p_credential_id,p_user_id,c.user_handle,p_public_key,p_counter,p_transports,p_device_type,p_backed_up,c.label);
  ELSE
    UPDATE app_private.staff_passkey_credentials SET counter=p_counter,device_type=p_device_type,backed_up=p_backed_up
      WHERE credential_id=p_credential_id AND user_id=p_user_id AND revoked_at IS NULL AND counter=p_previous_counter
      AND (p_counter>counter OR (p_counter=0 AND counter=0));
    IF NOT FOUND THEN RAISE EXCEPTION 'credential_unavailable'; END IF;
  END IF;
  UPDATE app_private.staff_passkey_challenges SET finalized_at=now() WHERE id=c.id;
  -- Registration does not authenticate access: require a fresh signed assertion.
  IF c.operation<>'register' THEN
    INSERT INTO app_private.staff_session_assurance(session_id,user_id,credential_id) VALUES(p_session_id,p_user_id,p_credential_id)
      ON CONFLICT(session_id) DO UPDATE SET credential_id=EXCLUDED.credential_id,verified_at=now(),expires_at=now()+INTERVAL '12 hours';
    IF c.operation IN ('approve','retry-payout','fraud-override') THEN
      IF c.binding IS DISTINCT FROM app_private.staff_withdrawal_binding(p_user_id,c.operation,(c.binding->>'withdrawalId')::uuid,c.binding->'payload') THEN RAISE EXCEPTION 'withdrawal_changed'; END IF;
      INSERT INTO app_private.withdrawal_authorization_proofs(user_id,session_id,credential_id,binding)
        VALUES(p_user_id,p_session_id,p_credential_id,c.binding) RETURNING id INTO v_proof;
    END IF;
  END IF;
  INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id)
    VALUES(p_user_id,'staff.passkey_'||c.operation,'user',p_user_id);
  RETURN jsonb_build_object('registered',c.operation='register','proofId',v_proof);
END;
$$;
CREATE FUNCTION public.revoke_staff_passkey_credential(p_user_id uuid,p_session_id uuid,p_credential_id text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.staff_passkey_service();
  PERFORM 1 FROM auth.users WHERE id=p_user_id FOR UPDATE;
  IF NOT app_private.staff_session_verified(p_user_id,p_session_id) OR NOT EXISTS (
    SELECT 1 FROM app_private.staff_session_assurance WHERE session_id=p_session_id AND verified_at>now()-INTERVAL '5 minutes') THEN RAISE EXCEPTION 'fresh_passkey_required'; END IF;
  IF (SELECT count(*) FROM app_private.staff_passkey_credentials WHERE user_id=p_user_id AND revoked_at IS NULL)<=1 THEN RAISE EXCEPTION 'last_credential'; END IF;
  UPDATE app_private.staff_passkey_credentials SET revoked_at=now() WHERE credential_id=p_credential_id AND user_id=p_user_id AND revoked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'credential_unavailable'; END IF;
  INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id) VALUES(p_user_id,'staff.passkey_revoked','user',p_user_id);
END;
$$;

-- No direct client grants on trust functions. Only the status projection is self-readable.
DO $$ DECLARE f record; BEGIN
  FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE (n.nspname='app_private' AND p.proname IN ('staff_passkey_account','staff_password_session','staff_session_verified',
      'staff_authority_assurance','staff_passkey_service','staff_withdrawal_snapshot','staff_withdrawal_binding'))
      OR (n.nspname='public' AND p.proname IN ('staff_passkey_status','staff_withdrawal_authorization_version','staff_passkey_credentials','issue_staff_passkey_enrollment_grant',
        'begin_staff_passkey_challenge','claim_staff_passkey_challenge','finish_staff_passkey_challenge','revoke_staff_passkey_credential'))
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',f.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.staff_passkey_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_withdrawal_authorization_version(uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION app_private.staff_authority_assurance() TO anon, authenticated;
NOTIFY pgrst,'reload schema';
