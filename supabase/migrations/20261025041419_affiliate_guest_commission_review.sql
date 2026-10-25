CREATE TABLE public.affiliate_guest_commission_reviews (
  attribution_id uuid PRIMARY KEY REFERENCES public.affiliate_attributions(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'released', 'rejected')),
  evidence_code text NOT NULL CHECK (evidence_code = 'guest_contact_matches_verified_owner_email'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  decided_by uuid REFERENCES public.users(id),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.affiliate_guest_commission_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.affiliate_guest_commission_reviews FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.affiliate_guest_commission_reviews TO service_role;

CREATE TABLE public.affiliate_guest_commission_review_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  attribution_id uuid NOT NULL REFERENCES public.affiliate_guest_commission_reviews(attribution_id) ON DELETE RESTRICT,
  version integer NOT NULL,
  action text NOT NULL CHECK (action IN ('held', 'released', 'rejected')),
  actor_id uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attribution_id, version)
);
ALTER TABLE public.affiliate_guest_commission_review_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.affiliate_guest_commission_review_events FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION app_private.capture_guest_affiliate_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_owner public.users%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = NEW.order_id;
  IF NOT FOUND OR v_order.guest_subject_id IS NULL THEN RETURN NEW; END IF;
  SELECT u.* INTO v_owner
    FROM public.affiliate_clicks c JOIN public.affiliate_links l ON l.id = c.link_id
    JOIN public.users u ON u.id = l.user_id
    WHERE c.id = NEW.click_id;
  IF FOUND AND v_owner.email_verified_at IS NOT NULL
    AND lower(btrim(v_order.contact_email)) = lower(btrim(v_owner.email)) THEN
    INSERT INTO public.affiliate_guest_commission_reviews(attribution_id, evidence_code)
    VALUES (NEW.id, 'guest_contact_matches_verified_owner_email')
    ON CONFLICT (attribution_id) DO NOTHING;
    INSERT INTO public.affiliate_guest_commission_review_events(attribution_id,version,action)
    VALUES (NEW.id,1,'held') ON CONFLICT (attribution_id,version) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION app_private.capture_guest_affiliate_review() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER affiliate_guest_commission_review_capture
  AFTER INSERT ON public.affiliate_attributions
  FOR EACH ROW EXECUTE FUNCTION app_private.capture_guest_affiliate_review();

-- The new atomic clearer and legacy hold clearer both skip a pending review.
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
  SELECT status INTO v_order_status FROM public.orders WHERE id = v_order_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'affiliate_order_missing'; END IF;
  SELECT * INTO v_attribution FROM public.affiliate_attributions WHERE id = p_attribution_id FOR UPDATE;
  IF NOT FOUND OR v_attribution.status <> 'pending' THEN RETURN jsonb_build_object('outcome', 'skipped'); END IF;
  IF v_attribution.order_id <> v_order_id THEN RAISE EXCEPTION 'affiliate_order_changed'; END IF;
  IF EXISTS (SELECT 1 FROM public.affiliate_guest_commission_reviews r
    WHERE r.attribution_id = p_attribution_id AND r.status = 'pending') THEN
    RETURN jsonb_build_object('outcome', 'review_required');
  END IF;
  IF p_matured_before IS NOT NULL AND v_attribution.created_at >= p_matured_before THEN
    RETURN jsonb_build_object('outcome', 'skipped');
  END IF;
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
  IF EXISTS (SELECT 1 FROM public.vendors v WHERE v.owner_id = v_owner_id
    AND v.status IN ('pending', 'approved', 'suspended'))
    OR EXISTS (SELECT 1 FROM public.outlet_managers om WHERE om.user_id = v_owner_id) THEN
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

-- Preserve the historical legacy wallet path while excluding new per-row reviews.
DO $$
DECLARE
  source text;
  original text := 'AND u.kyc_status = ''approved''';
  replacement text := 'AND u.kyc_status = ''approved''
       AND NOT EXISTS (SELECT 1 FROM public.affiliate_guest_commission_reviews gr WHERE gr.attribution_id = aa.id AND gr.status = ''pending'')';
BEGIN
  source := pg_get_functiondef('app_private.confirm_pending_earnings()'::regprocedure);
  IF position(original IN source) = 0 THEN
    RAISE EXCEPTION 'legacy_affiliate_clearer_shape_changed';
  END IF;
  EXECUTE replace(source, original, replacement);
END;
$$;

CREATE OR REPLACE FUNCTION app_private.resolve_guest_affiliate_commission_review(
  p_attribution_id uuid,
  p_expected_version integer,
  p_decision text,
  p_admin_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_review public.affiliate_guest_commission_reviews%ROWTYPE;
  v_attribution public.affiliate_attributions%ROWTYPE;
  v_owner_id uuid;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_decision NOT IN ('release', 'reject') OR p_admin_id IS NULL THEN
    RAISE EXCEPTION 'affiliate_review_input_invalid';
  END IF;
  SELECT * INTO v_attribution FROM public.affiliate_attributions WHERE id=p_attribution_id FOR UPDATE;
  IF NOT FOUND OR v_attribution.status <> 'pending' THEN
    RETURN jsonb_build_object('outcome', 'stale');
  END IF;
  SELECT * INTO v_review FROM public.affiliate_guest_commission_reviews
    WHERE attribution_id=p_attribution_id FOR UPDATE;
  IF NOT FOUND OR v_review.status <> 'pending' OR v_review.version <> p_expected_version THEN
    RETURN jsonb_build_object('outcome', 'stale');
  END IF;
  SELECT l.user_id INTO v_owner_id FROM public.affiliate_clicks c
    JOIN public.affiliate_links l ON l.id=c.link_id WHERE c.id=v_attribution.click_id;
  UPDATE public.affiliate_guest_commission_reviews SET
    status = CASE p_decision WHEN 'release' THEN 'released' ELSE 'rejected' END,
    version = version + 1, decided_by = p_admin_id, decided_at = now()
  WHERE attribution_id = p_attribution_id;
  INSERT INTO public.affiliate_guest_commission_review_events(attribution_id,version,action,actor_id)
  VALUES (p_attribution_id,v_review.version + 1,CASE p_decision WHEN 'release' THEN 'released' ELSE 'rejected' END,p_admin_id);
  IF p_decision = 'reject' THEN
    UPDATE public.affiliate_attributions SET status='rejected', rejected_at=now(), rejected_by=p_admin_id
    WHERE id=p_attribution_id;
  END IF;
  RETURN jsonb_build_object('outcome', 'resolved', 'decision', p_decision,
    'version', v_review.version + 1, 'owner_id', v_owner_id, 'amount_rm', v_attribution.commission_amount);
END;
$$;
REVOKE ALL ON FUNCTION app_private.resolve_guest_affiliate_commission_review(uuid,integer,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_private.resolve_guest_affiliate_commission_review(uuid,integer,text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.resolve_guest_affiliate_commission_review(
  p_attribution_id uuid,
  p_expected_version integer,
  p_decision text,
  p_admin_id uuid
) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT app_private.resolve_guest_affiliate_commission_review(p_attribution_id,p_expected_version,p_decision,p_admin_id);
$$;
REVOKE ALL ON FUNCTION public.resolve_guest_affiliate_commission_review(uuid,integer,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_guest_affiliate_commission_review(uuid,integer,text,uuid) TO service_role;
