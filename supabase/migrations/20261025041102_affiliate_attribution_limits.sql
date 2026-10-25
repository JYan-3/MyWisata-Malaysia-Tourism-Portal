-- Guard replay and the RM100 limited-affiliate monthly budget in the same
-- transaction as attribution creation. Existing duplicate history must be
-- reconciled explicitly; never delete financial records to make this index fit.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.affiliate_attributions
    GROUP BY order_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'affiliate_attribution_duplicate_orders_require_reconciliation';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS affiliate_attributions_order_id_unique
  ON public.affiliate_attributions(order_id);

CREATE OR REPLACE FUNCTION app_private.create_affiliate_attribution(
  p_order_id uuid,
  p_click_id uuid,
  p_commission_rate numeric
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_click public.affiliate_clicks%ROWTYPE;
  v_link public.affiliate_links%ROWTYPE;
  v_owner public.users%ROWTYPE;
  v_existing public.affiliate_attributions%ROWTYPE;
  v_cookie_days integer;
  v_month_start timestamptz;
  v_month_end timestamptz;
  v_month_total numeric;
  v_amount numeric;
  v_attribution_id uuid;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_order_id IS NULL OR p_click_id IS NULL OR p_commission_rate IS NULL
    OR p_commission_rate <= 0 OR p_commission_rate > 1 THEN
    RAISE EXCEPTION 'affiliate_attribution_input_invalid';
  END IF;

  -- Establish a consistent order -> owner lock order for retries and distinct
  -- orders. A replay returns the durable prior outcome before checking a cap.
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome', 'skipped'); END IF;
  SELECT * INTO v_existing FROM public.affiliate_attributions WHERE order_id = p_order_id;
  IF FOUND THEN RETURN jsonb_build_object('outcome', 'existing', 'attribution_id', v_existing.id); END IF;
  IF lower(v_order.status) NOT IN ('paid', 'completed') THEN
    RETURN jsonb_build_object('outcome', 'skipped');
  END IF;

  SELECT * INTO v_click FROM public.affiliate_clicks WHERE id = p_click_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('outcome', 'skipped'); END IF;
  SELECT * INTO v_link FROM public.affiliate_links WHERE id = v_click.link_id;
  IF NOT FOUND OR NOT v_link.is_active THEN RETURN jsonb_build_object('outcome', 'skipped'); END IF;

  SELECT * INTO v_owner FROM public.users WHERE id = v_link.user_id FOR UPDATE;
  IF NOT FOUND OR v_owner.kyc_status = 'rejected' THEN
    RETURN jsonb_build_object('outcome', 'skipped');
  END IF;
  IF EXISTS (SELECT 1 FROM public.vendors v WHERE v.owner_id = v_link.user_id
    AND v.status IN ('pending', 'approved', 'suspended'))
    OR EXISTS (SELECT 1 FROM public.outlet_managers om WHERE om.user_id = v_link.user_id) THEN
    RETURN jsonb_build_object('outcome', 'skipped');
  END IF;
  IF v_order.user_id IS NOT NULL AND v_order.user_id = v_link.user_id THEN
    RETURN jsonb_build_object('outcome', 'skipped');
  END IF;

  SELECT CASE WHEN value ~ '^[0-9]+$' AND value::integer > 0 THEN value::integer ELSE 30 END INTO v_cookie_days
    FROM public.platform_settings WHERE key = 'affiliate.cookie_days';
  v_cookie_days := COALESCE(v_cookie_days, 30);
  IF v_cookie_days < 1 OR v_click.created_at > COALESCE(v_order.created_at, now())
    OR v_click.created_at < COALESCE(v_order.created_at, now()) - make_interval(days => v_cookie_days) THEN
    RETURN jsonb_build_object('outcome', 'skipped');
  END IF;

  v_amount := round(v_order.total_amount * p_commission_rate, 2);
  IF v_amount <= 0 THEN RETURN jsonb_build_object('outcome', 'skipped'); END IF;

  IF NOT (v_owner.tier = 'kyc_verified' AND v_owner.kyc_status = 'approved') THEN
    v_month_start := date_trunc('month', now() AT TIME ZONE 'Asia/Kuala_Lumpur') AT TIME ZONE 'Asia/Kuala_Lumpur';
    v_month_end := (v_month_start AT TIME ZONE 'Asia/Kuala_Lumpur' + interval '1 month') AT TIME ZONE 'Asia/Kuala_Lumpur';
    SELECT COALESCE(sum(aa.commission_amount), 0) INTO v_month_total
    FROM public.affiliate_attributions aa
    JOIN public.affiliate_clicks c ON c.id = aa.click_id
    JOIN public.affiliate_links l ON l.id = c.link_id
    WHERE l.user_id = v_link.user_id
      AND aa.status IN ('pending', 'confirmed')
      AND aa.created_at >= v_month_start AND aa.created_at < v_month_end;
    IF v_month_total + v_amount > 100 THEN
      RETURN jsonb_build_object('outcome', 'monthly_cap_reached');
    END IF;
  END IF;

  INSERT INTO public.affiliate_attributions
    (click_id, order_id, commission_rate, commission_amount, status)
  VALUES (p_click_id, p_order_id, p_commission_rate, v_amount, 'pending')
  RETURNING id INTO v_attribution_id;

  RETURN jsonb_build_object('outcome', 'created', 'attribution_id', v_attribution_id,
    'owner_id', v_link.user_id, 'amount_rm', v_amount);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_affiliate_attribution(
  p_order_id uuid,
  p_click_id uuid,
  p_commission_rate numeric
) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT app_private.create_affiliate_attribution(p_order_id, p_click_id, p_commission_rate);
$$;

REVOKE ALL ON FUNCTION app_private.create_affiliate_attribution(uuid,uuid,numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_affiliate_attribution(uuid,uuid,numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_affiliate_attribution(uuid,uuid,numeric) TO service_role;
