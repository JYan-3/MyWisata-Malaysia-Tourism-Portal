-- Derive money inputs and commit the attribution and canonical ledger together.
CREATE OR REPLACE FUNCTION public.clear_affiliate_commission(
  p_attribution_id uuid,
  p_matured_before timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_attribution public.affiliate_attributions%ROWTYPE;
  v_owner public.users%ROWTYPE;
  v_order_id uuid;
  v_order_status text;
  v_owner_id uuid;
  v_amount_sen bigint;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  SELECT order_id INTO v_order_id FROM public.affiliate_attributions WHERE id = p_attribution_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome', 'skipped'); END IF;
  -- Serialize order changes before attribution and wallet writes.
  SELECT status INTO v_order_status FROM public.orders WHERE id = v_order_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'affiliate_order_missing'; END IF;
  SELECT * INTO v_attribution FROM public.affiliate_attributions WHERE id = p_attribution_id FOR UPDATE;
  IF NOT FOUND OR v_attribution.status <> 'pending' THEN RETURN jsonb_build_object('outcome', 'skipped'); END IF;
  IF v_attribution.order_id <> v_order_id THEN RAISE EXCEPTION 'affiliate_order_changed'; END IF;
  IF p_matured_before IS NOT NULL AND v_attribution.created_at >= p_matured_before THEN
    RETURN jsonb_build_object('outcome', 'skipped');
  END IF;
  -- Legacy credits already occupy the pending wallet bucket and use the old clearer.
  IF v_attribution.hold_until IS NOT NULL THEN RETURN jsonb_build_object('outcome', 'skipped'); END IF;
  SELECT l.user_id INTO v_owner_id
  FROM public.affiliate_clicks c JOIN public.affiliate_links l ON l.id = c.link_id
  WHERE c.id = v_attribution.click_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'affiliate_owner_missing'; END IF;
  SELECT * INTO v_owner FROM public.users WHERE id = v_owner_id FOR SHARE;
  IF NOT FOUND OR v_owner.status IS DISTINCT FROM 'active'
    OR v_owner.email_verified_at IS NULL OR v_owner.kyc_status IS DISTINCT FROM 'approved'
    OR v_owner.tier IS DISTINCT FROM 'kyc_verified' THEN
    RETURN jsonb_build_object('outcome', 'skipped');
  END IF;
  IF v_order_status IN ('cancelled', 'refunded') THEN
    UPDATE public.affiliate_attributions SET status = 'reversed', reversed_at = now() WHERE id = p_attribution_id;
    RETURN jsonb_build_object('outcome', 'reversed', 'reason', 'order ' || v_order_status);
  END IF;
  v_amount_sen := round(v_attribution.commission_amount * 100)::bigint;
  IF v_amount_sen <= 0 THEN RAISE EXCEPTION 'affiliate_amount_invalid'; END IF;
  INSERT INTO public.wallets(user_id) VALUES (v_owner_id) ON CONFLICT (user_id) DO NOTHING;
  PERFORM public.credit_earnings(v_owner_id, v_amount_sen, v_order_id,
    'Affiliate commission for order ' || left(v_order_id::text, 8));
  UPDATE public.affiliate_attributions SET status = 'confirmed', cleared_at = now(), confirmed_at = now()
  WHERE id = p_attribution_id;
  RETURN jsonb_build_object('outcome', 'confirmed', 'user_id', v_owner_id,
    'order_id', v_order_id, 'amount_rm', v_amount_sen::numeric / 100);
END;
$$;
REVOKE ALL ON FUNCTION public.clear_affiliate_commission(uuid,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_affiliate_commission(uuid,timestamptz) TO service_role;
