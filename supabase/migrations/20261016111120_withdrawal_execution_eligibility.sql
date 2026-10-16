-- Snapshot the verified-phone generation, not a second copy of the phone.
-- Legacy TNG requests have unknown historical identity and require review.
ALTER TABLE public.withdrawal_requests ADD COLUMN payout_phone_verified_at timestamptz;
CREATE FUNCTION app_private.snapshot_withdrawal_phone_generation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF TG_OP='UPDATE' THEN
  -- Reject may update the wallet before this row. Raising here rolls back that
  -- entire transaction, preserving reserves while an external claim is active.
  IF OLD.payout_execution_claim_token IS NOT NULL AND NEW.status IN ('hold','rejected') AND NEW.status IS DISTINCT FROM OLD.status THEN
   RAISE EXCEPTION 'payout_execution_in_progress';
  END IF;
  IF NEW.payout_phone_verified_at IS DISTINCT FROM OLD.payout_phone_verified_at THEN RAISE EXCEPTION 'withdrawal_identity_immutable'; END IF;
 ELSIF EXISTS(SELECT 1 FROM public.payout_destinations WHERE id=NEW.destination_id AND user_id=NEW.user_id AND provider='tng_direct_credit') THEN
  -- The later eligibility trigger populates NEW.payout_provider. Submission
  -- intentionally omits it, so read the authoritative destination directly.
  SELECT phone_verified_at INTO NEW.payout_phone_verified_at FROM public.users WHERE id=NEW.user_id;
 ELSE NEW.payout_phone_verified_at:=NULL;
 END IF;
 RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION app_private.snapshot_withdrawal_phone_generation() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER withdrawal_phone_generation BEFORE INSERT OR UPDATE ON public.withdrawal_requests
 FOR EACH ROW EXECUTE FUNCTION app_private.snapshot_withdrawal_phone_generation();

CREATE FUNCTION app_private.withdrawal_execution_failure(p_request uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.withdrawal_requests%ROWTYPE; u public.users%ROWTYPE; d public.payout_destinations%ROWTYPE; BEGIN
 SELECT * INTO r FROM public.withdrawal_requests WHERE id=p_request;
 SELECT * INTO u FROM public.users WHERE id=r.user_id;
 IF NOT FOUND THEN RETURN 'account_unavailable'; END IF;
 -- Called only by the service-only claim, so the existing resolver can safely
 -- evaluate this recipient without impersonating them or changing JWT claims.
 IF NOT coalesce((public.resolve_user_capability(r.user_id,'wallet.request_withdrawal')->>'allowed')::boolean,false) THEN RETURN 'withdrawal_eligibility_lost'; END IF;
 SELECT * INTO d FROM public.payout_destinations WHERE id=r.destination_id AND user_id=r.user_id FOR SHARE;
 IF NOT FOUND OR d.verification_status IS DISTINCT FROM 'verified'
  OR d.provider IS DISTINCT FROM r.payout_provider OR d.provider_reference IS DISTINCT FROM r.destination_provider_reference
  OR (d.cooldown_until IS NOT NULL AND d.cooldown_until>now()) THEN RETURN 'withdrawal_destination_changed'; END IF;
 IF r.payout_provider='tng_direct_credit' THEN
  IF d.dest_type<>'ewallet' OR u.phone_verified_at IS NULL OR u.phone IS NULL
   OR u.phone_verified_at IS DISTINCT FROM r.payout_phone_verified_at THEN RETURN 'withdrawal_identity_changed'; END IF;
 ELSIF r.payout_provider='stripe_connect' THEN
  IF d.dest_type<>'bank' OR NOT coalesce(u.stripe_payouts_enabled,false)
   OR u.stripe_connect_account_id IS DISTINCT FROM r.destination_provider_reference THEN RETURN 'withdrawal_destination_changed'; END IF;
 ELSE RETURN 'withdrawal_provider_unsupported'; END IF;
 RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION app_private.withdrawal_execution_failure(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.start_withdrawal_payout_attempt(p_withdrawal_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_request public.withdrawal_requests%ROWTYPE; reason text; owner_id uuid; BEGIN
 IF coalesce(auth.role(),'')<>'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
 SELECT user_id INTO owner_id FROM public.withdrawal_requests WHERE id=p_withdrawal_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'withdrawal_not_found'; END IF;
 -- Match submission lock order: user, request, destination, then wallet.
 PERFORM 1 FROM public.users WHERE id=owner_id FOR UPDATE;
 SELECT * INTO v_request FROM public.withdrawal_requests WHERE id=p_withdrawal_id FOR UPDATE;
 IF v_request.status<>'approved' THEN RAISE EXCEPTION 'withdrawal_not_approved'; END IF;
 -- Claimed/ambiguous attempts must be reconciled, never relabelled or released.
 IF v_request.payout_execution_claim_token IS NOT NULL THEN
  RETURN jsonb_build_object('request_id',p_withdrawal_id,'acquired',false,'started_at',v_request.payout_attempt_started_at);
 END IF;
 reason:=app_private.withdrawal_execution_failure(p_withdrawal_id);
 IF reason IS NOT NULL THEN
  UPDATE public.withdrawal_requests SET status='hold',customer_reason='Your withdrawal is paused for eligibility and destination review.',
   customer_reason_category='other',customer_visible_at=now(),updated_at=now() WHERE id=p_withdrawal_id;
  INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,before_data,after_data,note)
  VALUES(NULL,'withdrawal.eligibility_hold','withdrawal',p_withdrawal_id,
   jsonb_build_object('status',v_request.status,'approval_cycle',v_request.approval_cycle),
   jsonb_build_object('status','hold','reason_code',reason,'approval_cycle',v_request.approval_cycle),
   'Payout paused before provider request; reserved funds retained for manual review.');
  RETURN jsonb_build_object('request_id',p_withdrawal_id,'acquired',false,'requires_review',true,'reason_code',reason,'status','hold');
 END IF;
 UPDATE public.withdrawal_requests SET payout_attempt_started_at=coalesce(payout_attempt_started_at,now()),
  payout_execution_claim_token=gen_random_uuid(),payout_execution_claimed_at=now()
 WHERE id=p_withdrawal_id RETURNING * INTO v_request;
 RETURN jsonb_build_object('request_id',p_withdrawal_id,'acquired',true,'started_at',v_request.payout_attempt_started_at);
END; $$;
REVOKE ALL ON FUNCTION public.start_withdrawal_payout_attempt(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.start_withdrawal_payout_attempt(uuid) TO service_role;
NOTIFY pgrst,'reload schema';
