-- Preserve the exact wallet/provider split when a customer requests a full refund.
-- Historical rows retain NULL snapshots and are allocated on first processing.
ALTER TABLE public.refunds
  ADD COLUMN IF NOT EXISTS wallet_topup_sen BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wallet_earnings_sen BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS external_amount_sen BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS funding_snapshot_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provider_refund_event_id TEXT,
  ADD COLUMN IF NOT EXISTS manual_reference TEXT,
  ADD COLUMN IF NOT EXISTS review_note TEXT;

ALTER TABLE public.refunds
  DROP CONSTRAINT IF EXISTS refunds_funding_nonnegative;
ALTER TABLE public.refunds
  ADD CONSTRAINT refunds_funding_nonnegative CHECK (
    wallet_topup_sen >= 0 AND wallet_earnings_sen >= 0 AND external_amount_sen >= 0
  );

CREATE OR REPLACE FUNCTION public.snapshot_order_refund_funding(p_refund_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_refund public.refunds%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_payment public.payments%ROWTYPE;
  v_payment_count INTEGER;
  v_topup BIGINT;
  v_earnings BIGINT;
  v_external BIGINT;
  v_total BIGINT;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;

  SELECT * INTO v_refund FROM public.refunds WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'refund_not_found'; END IF;
  IF v_refund.funding_snapshot_at IS NOT NULL THEN
    RETURN jsonb_build_object('refund_id',v_refund.id,'wallet_topup_sen',v_refund.wallet_topup_sen,
      'wallet_earnings_sen',v_refund.wallet_earnings_sen,'external_amount_sen',v_refund.external_amount_sen,
      'idempotent',TRUE);
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = v_refund.order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'refund_order_not_found'; END IF;
  SELECT count(*)::INTEGER INTO v_payment_count
    FROM public.payments WHERE order_id = v_order.id AND status = 'succeeded';
  IF v_payment_count <> 1 THEN RAISE EXCEPTION 'refund_payment_ambiguous'; END IF;
  SELECT * INTO v_payment FROM public.payments
   WHERE order_id = v_order.id AND status = 'succeeded' FOR UPDATE;
  IF v_payment.id <> v_refund.payment_id THEN RAISE EXCEPTION 'refund_payment_mismatch'; END IF;

  SELECT
    COALESCE(sum(wt.amount_sen) FILTER (WHERE wt.bucket = 'topup'),0),
    COALESCE(sum(wt.amount_sen) FILTER (WHERE wt.bucket = 'earnings'),0)
    INTO v_topup,v_earnings
    FROM public.wallet_transactions wt
    JOIN public.checkout_wallet_reservations wr
      ON wt.idempotency_key IN (
        'wallet-split-reserve:' || wr.checkout_session_id::TEXT || ':topup',
        'wallet-split-reserve:' || wr.checkout_session_id::TEXT || ':earnings'
      )
   WHERE wt.order_id = v_order.id AND wt.type = 'spend' AND wt.direction = 'debit'
     AND wr.status = 'committed';

  v_total := ROUND(v_order.total_amount * 100)::BIGINT;
  v_external := ROUND(v_payment.amount * 100)::BIGINT;
  IF ROUND(v_refund.amount * 100)::BIGINT <> v_total
     OR v_topup + v_earnings + v_external <> v_total THEN
    RAISE EXCEPTION 'refund_funding_ledger_mismatch';
  END IF;

  UPDATE public.refunds
     SET wallet_topup_sen = v_topup,
         wallet_earnings_sen = v_earnings,
         external_amount_sen = v_external,
         funding_snapshot_at = NOW()
   WHERE id = v_refund.id;
  RETURN jsonb_build_object('refund_id',v_refund.id,'wallet_topup_sen',v_topup,
    'wallet_earnings_sen',v_earnings,'external_amount_sen',v_external,'idempotent',FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION public.request_order_refund(p_order_id UUID, p_user_id UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_payment public.payments%ROWTYPE;
  v_payment_count INTEGER;
  v_refund public.refunds%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;
  IF p_user_id IS NULL OR NULLIF(BTRIM(p_reason),'') IS NULL OR LENGTH(BTRIM(p_reason)) > 500 THEN
    RAISE EXCEPTION 'refund_request_invalid';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_order.user_id <> p_user_id THEN RAISE EXCEPTION 'refund_order_not_owned'; END IF;
  IF LOWER(v_order.status) NOT IN ('paid','completed') THEN RAISE EXCEPTION 'refund_order_not_paid'; END IF;
  IF v_order.total_amount <= 0 THEN RAISE EXCEPTION 'refund_amount_invalid'; END IF;
  SELECT count(*)::INTEGER INTO v_payment_count FROM public.payments
   WHERE order_id = v_order.id AND status = 'succeeded';
  IF v_payment_count <> 1 THEN RAISE EXCEPTION 'refund_payment_ambiguous'; END IF;
  SELECT * INTO v_payment FROM public.payments WHERE order_id = v_order.id AND status = 'succeeded' FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.refunds WHERE order_id = v_order.id AND status IN ('pending','approved','processed')) THEN
    RAISE EXCEPTION 'refund_already_active';
  END IF;
  INSERT INTO public.refunds(payment_id,order_id,amount,reason,status)
    VALUES(v_payment.id,v_order.id,v_order.total_amount,BTRIM(p_reason),'pending')
    RETURNING * INTO v_refund;
  PERFORM public.snapshot_order_refund_funding(v_refund.id);
  SELECT * INTO v_refund FROM public.refunds WHERE id = v_refund.id;
  RETURN jsonb_build_object('id',v_refund.id,'status',v_refund.status,'amount',v_refund.amount,
    'wallet_topup_sen',v_refund.wallet_topup_sen,'wallet_earnings_sen',v_refund.wallet_earnings_sen,
    'external_amount_sen',v_refund.external_amount_sen,'reason',v_refund.reason,'created_at',v_refund.created_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.process_wallet_refund(
  p_refund_id UUID, p_note TEXT DEFAULT NULL, p_actor_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_refund public.refunds%ROWTYPE;
  v_payment public.payments%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_wallet public.wallets%ROWTYPE;
  v_topup BIGINT;
  v_earnings BIGINT;
  v_total BIGINT;
  v_credit BIGINT;
  v_new_topup BIGINT := 0;
  v_new_earnings BIGINT := 0;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;
  IF p_actor_id IS NOT NULL AND NOT public.is_super_admin(p_actor_id) THEN
    RAISE EXCEPTION 'super_admin_required';
  END IF;
  SELECT * INTO v_refund FROM public.refunds WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'refund_not_found'; END IF;
  IF v_refund.status = 'processed' THEN
    RETURN jsonb_build_object('refund_id',v_refund.id,'status','processed','idempotent',TRUE);
  END IF;
  IF v_refund.status NOT IN ('pending','approved') THEN RAISE EXCEPTION 'refund_not_actionable'; END IF;
  IF v_refund.funding_snapshot_at IS NULL THEN PERFORM public.snapshot_order_refund_funding(v_refund.id); END IF;
  SELECT * INTO v_refund FROM public.refunds WHERE id = p_refund_id FOR UPDATE;
  SELECT * INTO v_order FROM public.orders WHERE id = v_refund.order_id FOR UPDATE;
  SELECT * INTO v_payment FROM public.payments WHERE id = v_refund.payment_id FOR UPDATE;
  IF NOT FOUND OR v_payment.status <> 'succeeded' THEN RAISE EXCEPTION 'refund_payment_not_succeeded'; END IF;
  IF v_payment.method NOT IN ('wallet','wallet_split','stripe_card','ewallet','bank_transfer','mock_card') THEN
    RAISE EXCEPTION 'wallet_refund_method_invalid';
  END IF;
  v_topup := v_refund.wallet_topup_sen;
  v_earnings := v_refund.wallet_earnings_sen;
  v_total := ROUND(v_order.total_amount * 100)::BIGINT;
  IF ROUND(v_refund.amount * 100)::BIGINT <> v_total
     OR v_topup + v_earnings + v_refund.external_amount_sen <> v_total THEN
    RAISE EXCEPTION 'refund_funding_ledger_mismatch';
  END IF;
  IF v_refund.external_amount_sen > 0
     AND (v_refund.status <> 'approved' OR (v_refund.provider_refund_id IS NULL AND v_refund.manual_reference IS NULL)) THEN
    RAISE EXCEPTION 'provider_refund_not_confirmed';
  END IF;
  IF v_refund.external_amount_sen=0 AND v_payment.method NOT IN ('wallet','wallet_split') THEN
    RAISE EXCEPTION 'provider_refund_amount_missing';
  END IF;
  SELECT COALESCE(sum(wt.amount_sen) FILTER (WHERE wt.bucket='topup'),0),
         COALESCE(sum(wt.amount_sen) FILTER (WHERE wt.bucket='earnings'),0)
    INTO v_credit,v_earnings
    FROM public.wallet_transactions wt
    JOIN public.checkout_wallet_reservations wr ON wt.idempotency_key IN (
      'wallet-split-reserve:' || wr.checkout_session_id::TEXT || ':topup',
      'wallet-split-reserve:' || wr.checkout_session_id::TEXT || ':earnings'
    )
   WHERE wt.order_id=v_order.id AND wt.type='spend' AND wt.direction='debit' AND wr.status='committed';
  IF v_credit <> v_topup OR v_earnings <> v_refund.wallet_earnings_sen THEN
    RAISE EXCEPTION 'wallet_refund_ledger_mismatch';
  END IF;
  v_earnings := v_refund.wallet_earnings_sen;

  IF v_topup + v_earnings > 0 THEN
    SELECT * INTO v_wallet FROM public.wallets WHERE user_id=v_order.user_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'wallet_not_found'; END IF;
    IF v_topup > 0 THEN
      INSERT INTO public.wallet_transactions(user_id,wallet_id,order_id,idempotency_key,type,amount_sen,bucket,direction,note)
      VALUES(v_order.user_id,v_wallet.id,v_order.id,'wallet-refund:'||v_refund.id::TEXT||':topup','refund',v_topup,'topup','credit',COALESCE(p_note,'Order refund'))
      ON CONFLICT DO NOTHING RETURNING amount_sen INTO v_new_topup;
    END IF;
    IF v_earnings > 0 THEN
      INSERT INTO public.wallet_transactions(user_id,wallet_id,order_id,idempotency_key,type,amount_sen,bucket,direction,note)
      VALUES(v_order.user_id,v_wallet.id,v_order.id,'wallet-refund:'||v_refund.id::TEXT||':earnings','refund',v_earnings,'earnings','credit',COALESCE(p_note,'Order refund'))
      ON CONFLICT DO NOTHING RETURNING amount_sen INTO v_new_earnings;
    END IF;
    UPDATE public.wallets SET topup_sen=topup_sen+COALESCE(v_new_topup,0),
      earnings_sen=earnings_sen+COALESCE(v_new_earnings,0),updated_at=NOW() WHERE id=v_wallet.id;
  END IF;
  UPDATE public.refunds SET status='processed',processed_by=p_actor_id,processed_at=NOW(),
    review_note=COALESCE(NULLIF(BTRIM(p_note),''),review_note),updated_at=NOW() WHERE id=v_refund.id;
  UPDATE public.payments SET status='refunded',updated_at=NOW() WHERE id=v_payment.id;
  UPDATE public.orders SET status='refunded',updated_at=NOW() WHERE id=v_order.id;
  INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,before_data,after_data,note)
  VALUES(p_actor_id,'order.refunded','refund',v_refund.id,
    jsonb_build_object('status',v_refund.status,'external_amount_sen',v_refund.external_amount_sen),
    jsonb_build_object('status','processed','wallet_topup_sen',v_topup,'wallet_earnings_sen',v_earnings),p_note);
  INSERT INTO public.notifications(user_id,type,title,body,link)
  VALUES(v_order.user_id,'order_refund','Refund processed','Your refund was completed using the original payment and wallet funding sources.','/customer/wallet');
  RETURN jsonb_build_object('refund_id',v_refund.id,'status','processed','idempotent',FALSE,
    'wallet_topup_sen',v_topup,'wallet_earnings_sen',v_earnings,'external_amount_sen',v_refund.external_amount_sen);
END;
$$;

CREATE OR REPLACE FUNCTION public.process_wallet_refund(p_refund_id UUID,p_note TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  RETURN public.process_wallet_refund(p_refund_id,p_note,NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_order_refund_provider_outcome(
  p_refund_id UUID, p_provider_refund_id TEXT, p_outcome TEXT, p_amount_sen BIGINT,
  p_currency TEXT DEFAULT 'MYR', p_failure_code TEXT DEFAULT NULL, p_failure_message TEXT DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL, p_note TEXT DEFAULT NULL, p_event_id TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_refund public.refunds%ROWTYPE;
  v_payment public.payments%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_result JSONB;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;
  IF p_actor_id IS NOT NULL AND NOT public.is_super_admin(p_actor_id) THEN RAISE EXCEPTION 'super_admin_required'; END IF;
  IF p_outcome NOT IN ('pending','succeeded','failed') THEN RAISE EXCEPTION 'refund_outcome_invalid'; END IF;
  IF NULLIF(BTRIM(p_provider_refund_id),'') IS NULL OR LENGTH(p_provider_refund_id)>255 THEN RAISE EXCEPTION 'provider_refund_id_invalid'; END IF;
  IF p_amount_sen IS NULL OR p_amount_sen<=0 OR UPPER(COALESCE(p_currency,''))<>'MYR' THEN RAISE EXCEPTION 'refund_amount_invalid'; END IF;
  SELECT * INTO v_refund FROM public.refunds WHERE id=p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'refund_not_found'; END IF;
  IF v_refund.funding_snapshot_at IS NULL THEN PERFORM public.snapshot_order_refund_funding(v_refund.id); END IF;
  SELECT * INTO v_refund FROM public.refunds WHERE id=p_refund_id FOR UPDATE;
  SELECT * INTO v_order FROM public.orders WHERE id=v_refund.order_id FOR UPDATE;
  SELECT * INTO v_payment FROM public.payments WHERE id=v_refund.payment_id FOR UPDATE;
  IF v_payment.provider<>'stripe' THEN RAISE EXCEPTION 'stripe_refund_payment_invalid'; END IF;
  IF p_amount_sen<>v_refund.external_amount_sen THEN RAISE EXCEPTION 'refund_amount_mismatch'; END IF;
  IF v_refund.provider_refund_id IS NOT NULL AND v_refund.provider_refund_id IS DISTINCT FROM p_provider_refund_id THEN
    RAISE EXCEPTION 'provider_refund_id_mismatch';
  END IF;
  IF v_refund.status='processed' THEN RETURN jsonb_build_object('refund_id',v_refund.id,'status','processed','idempotent',TRUE); END IF;
  IF v_payment.status<>'succeeded' THEN RAISE EXCEPTION 'stripe_refund_payment_invalid'; END IF;
  IF v_refund.status='rejected' AND p_outcome='failed' THEN
    RETURN jsonb_build_object('refund_id',v_refund.id,'status','rejected','idempotent',TRUE);
  END IF;
  IF v_refund.status='rejected' THEN RAISE EXCEPTION 'refund_provider_outcome_terminal'; END IF;
  IF v_refund.status NOT IN ('pending','approved') THEN RAISE EXCEPTION 'refund_not_awaiting_provider'; END IF;
  IF v_refund.status='approved' AND p_outcome='pending' THEN
    RETURN jsonb_build_object('refund_id',v_refund.id,'status','approved','idempotent',TRUE);
  END IF;
  UPDATE public.refunds SET provider_refund_id=p_provider_refund_id,
    provider_refund_event_id=COALESCE(p_event_id,provider_refund_event_id),
    status=CASE WHEN p_outcome='pending' THEN 'approved' WHEN p_outcome='failed' THEN 'rejected' ELSE 'approved' END,
    provider_failure_code=CASE WHEN p_outcome='failed' THEN LEFT(NULLIF(BTRIM(p_failure_code),''),120) ELSE NULL END,
    provider_failure_message=CASE WHEN p_outcome='failed' THEN LEFT(NULLIF(BTRIM(p_failure_message),''),500) ELSE NULL END,
    review_note=COALESCE(NULLIF(BTRIM(p_note),''),review_note),updated_at=NOW()
   WHERE id=v_refund.id;
  IF p_outcome='succeeded' THEN
    SELECT public.process_wallet_refund(v_refund.id,p_note,p_actor_id) INTO v_result;
    RETURN v_result || jsonb_build_object('provider_refund_id',p_provider_refund_id);
  END IF;
  RETURN jsonb_build_object('refund_id',v_refund.id,'status',CASE WHEN p_outcome='pending' THEN 'approved' ELSE 'rejected' END,
    'provider_refund_id',p_provider_refund_id,'idempotent',FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_manual_order_refund(
  p_refund_id UUID,p_manual_reference TEXT,p_actor_id UUID,p_note TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_refund public.refunds%ROWTYPE;
  v_payment public.payments%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF p_actor_id IS NULL OR NOT public.is_super_admin(p_actor_id) THEN RAISE EXCEPTION 'super_admin_required'; END IF;
  IF LENGTH(BTRIM(COALESCE(p_manual_reference,'')))<5 OR LENGTH(p_manual_reference)>255 THEN RAISE EXCEPTION 'manual_refund_reference_required'; END IF;
  SELECT * INTO v_refund FROM public.refunds WHERE id=p_refund_id FOR UPDATE;
  IF NOT FOUND OR v_refund.status<>'pending' THEN RAISE EXCEPTION 'refund_not_pending'; END IF;
  IF v_refund.funding_snapshot_at IS NULL THEN PERFORM public.snapshot_order_refund_funding(v_refund.id); END IF;
  SELECT * INTO v_refund FROM public.refunds WHERE id=p_refund_id FOR UPDATE;
  SELECT * INTO v_payment FROM public.payments WHERE id=v_refund.payment_id FOR UPDATE;
  IF v_payment.provider='stripe' OR v_payment.provider IN ('tng_ewallet_simulator','grabpay_simulator','bank_transfer_simulator') THEN
    RAISE EXCEPTION 'manual_refund_provider_not_supported';
  END IF;
  UPDATE public.refunds SET status='approved',manual_reference=BTRIM(p_manual_reference),updated_at=NOW() WHERE id=v_refund.id;
  RETURN public.process_wallet_refund(v_refund.id,p_note,p_actor_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.begin_simulated_refund(
  p_refund_id UUID,p_provider TEXT,p_provider_refund_id TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_refund public.refunds%ROWTYPE; v_payment public.payments%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF p_provider NOT IN ('tng_ewallet_simulator','grabpay_simulator','bank_transfer_simulator') THEN RAISE EXCEPTION 'refund_provider_invalid'; END IF;
  IF COALESCE(p_provider_refund_id,'') !~ '^sim_refund_[0-9a-f]{40}$' THEN RAISE EXCEPTION 'provider_refund_id_invalid'; END IF;
  SELECT * INTO v_refund FROM public.refunds WHERE id=p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'refund_not_found'; END IF;
  IF v_refund.status<>'pending' THEN RAISE EXCEPTION 'refund_not_pending'; END IF;
  IF v_refund.funding_snapshot_at IS NULL THEN PERFORM public.snapshot_order_refund_funding(v_refund.id); END IF;
  SELECT * INTO v_refund FROM public.refunds WHERE id=p_refund_id FOR UPDATE;
  SELECT * INTO v_payment FROM public.payments WHERE id=v_refund.payment_id FOR UPDATE;
  IF v_payment.provider<>p_provider OR v_payment.status<>'succeeded' THEN RAISE EXCEPTION 'refund_provider_mismatch'; END IF;
  IF v_refund.external_amount_sen<=0 THEN RAISE EXCEPTION 'refund_external_leg_missing'; END IF;
  IF EXISTS(SELECT 1 FROM public.refunds r WHERE r.order_id=v_refund.order_id AND r.id<>v_refund.id AND r.status IN ('pending','approved','processed')) THEN
    RAISE EXCEPTION 'refund_already_active';
  END IF;
  UPDATE public.refunds SET status='approved',provider_refund_id=p_provider_refund_id,provider_refund_event_id=NULL,
    provider_failure_code=NULL,provider_failure_message=NULL,attempt_count=attempt_count+1,updated_at=NOW() WHERE id=v_refund.id;
  RETURN jsonb_build_object('refund_id',v_refund.id,'order_id',v_refund.order_id,'status','approved','provider',p_provider,
    'provider_refund_id',p_provider_refund_id,'amount_sen',v_refund.external_amount_sen,'attempt_count',v_refund.attempt_count+1);
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_simulated_refund(
  p_refund_id UUID,p_provider TEXT,p_event_id TEXT,p_provider_refund_id TEXT,p_outcome TEXT,
  p_payload_sha256 TEXT,p_amount_sen BIGINT,p_currency TEXT,p_failure_code TEXT,p_failure_message TEXT,p_retryable BOOLEAN
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_refund public.refunds%ROWTYPE; v_payment public.payments%ROWTYPE; v_event public.payment_events%ROWTYPE;
  v_event_type TEXT; v_status TEXT; v_result JSONB;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  IF p_provider NOT IN ('tng_ewallet_simulator','grabpay_simulator','bank_transfer_simulator') THEN RAISE EXCEPTION 'refund_provider_invalid'; END IF;
  IF p_outcome NOT IN ('succeeded','failed') THEN RAISE EXCEPTION 'refund_outcome_invalid'; END IF;
  IF BTRIM(COALESCE(p_event_id,''))='' OR LENGTH(p_event_id)>255 THEN RAISE EXCEPTION 'refund_event_id_invalid'; END IF;
  IF COALESCE(p_payload_sha256,'') !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'refund_payload_hash_invalid'; END IF;
  IF p_amount_sen IS NULL OR p_amount_sen<=0 OR UPPER(COALESCE(p_currency,''))<>'MYR' THEN RAISE EXCEPTION 'refund_amount_invalid'; END IF;
  SELECT * INTO v_refund FROM public.refunds WHERE id=p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'refund_not_found'; END IF;
  IF v_refund.funding_snapshot_at IS NULL THEN PERFORM public.snapshot_order_refund_funding(v_refund.id); END IF;
  SELECT * INTO v_refund FROM public.refunds WHERE id=p_refund_id FOR UPDATE;
  SELECT * INTO v_payment FROM public.payments WHERE id=v_refund.payment_id FOR UPDATE;
  IF v_payment.provider<>p_provider THEN RAISE EXCEPTION 'refund_provider_mismatch'; END IF;
  IF v_refund.provider_refund_id IS DISTINCT FROM p_provider_refund_id THEN RAISE EXCEPTION 'provider_refund_id_mismatch'; END IF;
  IF v_refund.external_amount_sen<>p_amount_sen THEN RAISE EXCEPTION 'refund_amount_mismatch'; END IF;
  v_event_type:='refund.'||p_outcome;
  SELECT * INTO v_event FROM public.payment_events WHERE provider=p_provider AND provider_event_id=p_event_id FOR UPDATE;
  IF FOUND THEN
    IF v_event.payload_hash IS DISTINCT FROM p_payload_sha256 OR v_event.order_id IS DISTINCT FROM v_refund.order_id
       OR v_event.event_type IS DISTINCT FROM v_event_type OR v_refund.provider_refund_event_id IS DISTINCT FROM p_event_id THEN
      RAISE EXCEPTION 'refund_provider_event_conflict';
    END IF;
    RETURN jsonb_build_object('refund_id',v_refund.id,'order_id',v_refund.order_id,'status',v_refund.status,'idempotent',TRUE);
  END IF;
  IF v_payment.status<>'succeeded' THEN RAISE EXCEPTION 'refund_payment_not_succeeded'; END IF;
  IF v_refund.status<>'approved' THEN RAISE EXCEPTION 'refund_not_awaiting_provider'; END IF;
  INSERT INTO public.payment_events(provider,provider_event_id,checkout_session_id,order_id,event_type,payload_hash)
    VALUES(p_provider,p_event_id,NULL,v_refund.order_id,v_event_type,p_payload_sha256);
  IF p_outcome='succeeded' THEN
    UPDATE public.refunds SET provider_refund_event_id=p_event_id,provider_failure_code=NULL,provider_failure_message=NULL,updated_at=NOW()
     WHERE id=v_refund.id;
    SELECT public.process_wallet_refund(v_refund.id,NULL,NULL) INTO v_result;
    v_status:='processed';
  ELSE
    v_status:=CASE WHEN COALESCE(p_retryable,FALSE) THEN 'pending' ELSE 'rejected' END;
    UPDATE public.refunds SET status=v_status,provider_refund_event_id=p_event_id,
      provider_failure_code=LEFT(NULLIF(BTRIM(p_failure_code),''),120),
      provider_failure_message=LEFT(NULLIF(BTRIM(p_failure_message),''),500),updated_at=NOW()
     WHERE id=v_refund.id;
  END IF;
  RETURN jsonb_build_object('refund_id',v_refund.id,'order_id',v_refund.order_id,'status',v_status,'idempotent',FALSE);
END;
$$;

REVOKE ALL ON FUNCTION public.snapshot_order_refund_funding(UUID), public.request_order_refund(UUID,UUID,TEXT),
  public.process_wallet_refund(UUID,TEXT), public.process_wallet_refund(UUID,TEXT,UUID),
  public.record_order_refund_provider_outcome(UUID,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,UUID,TEXT,TEXT),
  public.complete_manual_order_refund(UUID,TEXT,UUID,TEXT), public.begin_simulated_refund(UUID,TEXT,TEXT),
  public.settle_simulated_refund(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.snapshot_order_refund_funding(UUID), public.request_order_refund(UUID,UUID,TEXT),
  public.process_wallet_refund(UUID,TEXT), public.process_wallet_refund(UUID,TEXT,UUID),
  public.record_order_refund_provider_outcome(UUID,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,UUID,TEXT,TEXT),
  public.complete_manual_order_refund(UUID,TEXT,UUID,TEXT), public.begin_simulated_refund(UUID,TEXT,TEXT),
  public.settle_simulated_refund(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,BOOLEAN)
  TO service_role;
