-- Internal wallet operations must never be exposed to customer RPC callers.
-- Keep ledger behavior and signatures; service JWT and ACL are both required.
REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;


CREATE OR REPLACE FUNCTION public.credit_earnings(
  p_user_id    UUID,
  p_amount_sen BIGINT,
  p_ref_id     UUID DEFAULT NULL,
  p_note       TEXT DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_wallet_id UUID;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO v_wallet_id
    FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wallet_not_found for user %', p_user_id;
  END IF;

  UPDATE public.wallets
     SET earnings_sen = earnings_sen + p_amount_sen,
         updated_at   = now()
   WHERE id = v_wallet_id;

  INSERT INTO public.wallet_transactions
    (user_id, wallet_id, type, amount_sen, bucket, direction, note)
  VALUES
    (p_user_id, v_wallet_id, 'earnings', p_amount_sen, 'earnings', 'credit',
     COALESCE(p_note, 'Earnings credit'));
END;
$$;

REVOKE ALL ON FUNCTION public.credit_earnings(uuid,bigint,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_earnings(uuid,bigint,uuid,text) TO service_role;


CREATE OR REPLACE FUNCTION public.credit_pending_earnings(
  p_user_id    UUID,
  p_amount_sen BIGINT,
  p_ref_id     UUID DEFAULT NULL,
  p_note       TEXT DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_wallet_id UUID;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO v_wallet_id
    FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wallet_not_found for user %', p_user_id;
  END IF;

  UPDATE public.wallets
     SET pending_earnings_sen = pending_earnings_sen + p_amount_sen,
         updated_at           = now()
   WHERE id = v_wallet_id;

  INSERT INTO public.wallet_transactions
    (user_id, wallet_id, type, amount_sen, bucket, direction, note)
  VALUES
    (p_user_id, v_wallet_id, 'earnings_pending', p_amount_sen,
     'pending_earnings', 'credit',
     COALESCE(p_note, 'Commission credited — pending hold period'));
END;
$$;

REVOKE ALL ON FUNCTION public.credit_pending_earnings(uuid,bigint,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_pending_earnings(uuid,bigint,uuid,text) TO service_role;


CREATE OR REPLACE FUNCTION public.reserve_for_withdrawal(
  p_user_id       UUID,
  p_amount_sen    BIGINT,
  p_withdrawal_id UUID
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_wallet_id UUID;
  v_earnings  BIGINT;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  SELECT id, earnings_sen INTO v_wallet_id, v_earnings
    FROM public.wallets WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'wallet_not_found'; END IF;

  IF v_earnings < p_amount_sen THEN
    RAISE EXCEPTION 'insufficient_earnings: have % sen, need % sen',
      v_earnings, p_amount_sen;
  END IF;

  UPDATE public.wallets
     SET earnings_sen = earnings_sen - p_amount_sen,
         updated_at   = now()
   WHERE id = v_wallet_id;

  INSERT INTO public.wallet_transactions
    (user_id, wallet_id, type, amount_sen, bucket, direction, withdrawal_id, note)
  VALUES
    (p_user_id, v_wallet_id, 'withdrawal_reserve', p_amount_sen, 'earnings', 'debit',
     p_withdrawal_id, 'Withdrawal reserved — pending payout');
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_for_withdrawal(uuid,bigint,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_for_withdrawal(uuid,bigint,uuid) TO service_role;


CREATE OR REPLACE FUNCTION public.reverse_pending_earnings(
  p_attribution_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id    UUID;
  v_wallet_id  UUID;
  v_amount_sen BIGINT;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  SELECT
    al.user_id,
    ROUND(aa.commission_amount * 100)::BIGINT
  INTO v_user_id, v_amount_sen
  FROM  public.affiliate_attributions aa
  JOIN  public.affiliate_clicks       ac ON ac.id = aa.click_id
  JOIN  public.affiliate_links        al ON al.id = ac.link_id
  WHERE aa.id     = p_attribution_id
    AND aa.status = 'pending'
  FOR UPDATE OF aa;

  IF NOT FOUND THEN RETURN FALSE; END IF;

  SELECT id INTO v_wallet_id
    FROM public.wallets WHERE user_id = v_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  UPDATE public.wallets
     SET pending_earnings_sen = pending_earnings_sen - LEAST(v_amount_sen, pending_earnings_sen),
         updated_at           = now()
   WHERE id = v_wallet_id;

  INSERT INTO public.wallet_transactions
    (user_id, wallet_id, type, amount_sen, bucket, direction, note)
  VALUES
    (v_user_id, v_wallet_id, 'earnings_reverse', v_amount_sen,
     'pending_earnings', 'debit',
     'Pending commission reversed — order refunded');

  UPDATE public.affiliate_attributions
     SET status      = 'reversed',
         reversed_at = now()
   WHERE id = p_attribution_id;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_pending_earnings(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_pending_earnings(uuid) TO service_role;


CREATE OR REPLACE FUNCTION public.get_withdrawal_notification_snapshot(p_withdrawal_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_snapshot JSONB;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object(
    'customer', jsonb_build_object(
      'id', u.id,
      'displayName', COALESCE(u.full_name, 'Customer'),
      'email', u.email
    ),
    'requestTime', wr.created_at,
    'kycStatus', COALESCE(u.kyc_status, 'unverified'),
    'risk', jsonb_build_object(
      'level', COALESCE(risk.risk_level, 'review'),
      'reasons', COALESCE(risk.snapshot->'risk_factors', risk.snapshot->'fraud_flags', '[]'::jsonb)
    ),
    'sourceTotals', jsonb_build_object(
      'rewardSen', COALESCE((SELECT SUM(wt.amount_sen) FROM public.wallet_transactions wt WHERE wt.user_id = wr.user_id AND wt.direction = 'credit' AND wt.type IN ('reward_pending','reward_cleared','recommendation_reward_reversed')), 0),
      'affiliateSen', COALESCE((SELECT SUM(wt.amount_sen) FROM public.wallet_transactions wt WHERE wt.user_id = wr.user_id AND wt.direction = 'credit' AND wt.type = 'affiliate_commission'), 0),
      'otherSen', COALESCE((SELECT SUM(wt.amount_sen) FROM public.wallet_transactions wt WHERE wt.user_id = wr.user_id AND wt.direction = 'credit' AND wt.type NOT IN ('reward_pending','reward_cleared','recommendation_reward_reversed','affiliate_commission')), 0)
    ),
    'destination', jsonb_build_object(
      'type', COALESCE(wr.destination_provider, pd.provider, 'unknown'),
      'maskedReference', COALESCE(wr.destination_masked_ref, pd.masked_ref, 'masked')
    )
  ) INTO v_snapshot
  FROM public.withdrawal_requests wr
  JOIN public.users u ON u.id = wr.user_id
  LEFT JOIN public.payout_destinations pd ON pd.id = wr.destination_id
  LEFT JOIN LATERAL (
    SELECT risk_level, snapshot
      FROM public.withdrawal_risk_assessments
     WHERE withdrawal_id = wr.id
     ORDER BY assessed_at DESC
     LIMIT 1
  ) risk ON TRUE
  WHERE wr.id = p_withdrawal_id;

  IF v_snapshot IS NULL THEN RAISE EXCEPTION 'withdrawal_not_found'; END IF;
  RETURN v_snapshot;
END;
$$;

REVOKE ALL ON FUNCTION public.get_withdrawal_notification_snapshot(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_withdrawal_notification_snapshot(uuid) TO service_role;


CREATE OR REPLACE FUNCTION public.submit_withdrawal(
  p_user_id        UUID,
  p_amount         NUMERIC,
  p_destination_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_wallet          public.wallets%ROWTYPE;
  v_request_id      UUID;
  v_threshold       NUMERIC;
  v_requires_dual   BOOLEAN;
  v_kyc_status      VARCHAR;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  -- Check KYC gate
  SELECT kyc_status INTO v_kyc_status FROM public.users WHERE id = p_user_id;
  IF v_kyc_status != 'approved' THEN
    RAISE EXCEPTION 'KYC not approved (current: %)', v_kyc_status;
  END IF;

  -- Lock wallet
  SELECT * INTO v_wallet
    FROM public.wallets
   WHERE user_id = p_user_id
   FOR UPDATE;

  IF v_wallet.available_balance < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance: available=% requested=%',
      v_wallet.available_balance, p_amount;
  END IF;

  -- Threshold from public.platform_settings
  SELECT value::NUMERIC INTO v_threshold
    FROM public.platform_settings WHERE key = 'withdrawal.high_value_rm';
  v_requires_dual := p_amount >= COALESCE(v_threshold, 500);

  -- Create request
  INSERT INTO public.withdrawal_requests (user_id, wallet_id, destination_id, amount, requires_dual_approval)
  VALUES (p_user_id, v_wallet.id, p_destination_id, p_amount, v_requires_dual)
  RETURNING id INTO v_request_id;

  -- Reserve funds: available goes down, ledger records reserve
  UPDATE public.wallets
     SET available_balance = available_balance - p_amount,
         updated_at = NOW()
   WHERE id = v_wallet.id;

  INSERT INTO public.wallet_ledger (wallet_id, entry_type, amount, balance_type, reference_id, note)
  VALUES (v_wallet.id, 'withdrawal_reserve', -p_amount, 'available',
          v_request_id, 'Reserved for withdrawal request');

  RETURN jsonb_build_object(
    'request_id', v_request_id,
    'requires_dual_approval', v_requires_dual,
    'new_available_balance', v_wallet.available_balance - p_amount
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_withdrawal(uuid,numeric,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_withdrawal(uuid,numeric,uuid) TO service_role;
