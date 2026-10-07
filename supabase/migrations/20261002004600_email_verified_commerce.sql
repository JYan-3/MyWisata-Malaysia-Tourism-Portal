-- Email is the purchase qualification; phone remains required for AI and top-up.
DO $$
DECLARE v_sql TEXT; v_new TEXT;
BEGIN
  v_sql := pg_get_functiondef('public.capability_hard_guard(uuid,text)'::regprocedure);
  v_new := replace(v_sql,
    '''commerce.booking'', ''commerce.purchase'', ''commerce.checkout'', ''ai.basic_recommendation''',
    '''wallet.top_up'', ''ai.basic_recommendation''');
  v_new := replace(v_new, '''wallet.request_withdrawal''\n  ) AND NOT v_email', '''wallet.request_withdrawal'', ''wallet.top_up''\n  ) AND NOT v_email');
  -- Existing source uses real newlines, not backslash escapes.
  v_new := replace(v_new, E'''wallet.request_withdrawal''\n  ) AND NOT v_email', E'''wallet.request_withdrawal'', ''wallet.top_up''\n  ) AND NOT v_email');
  IF v_new = v_sql OR position('''wallet.top_up''' IN v_new) = 0 THEN
    RAISE EXCEPTION 'commerce_guard_definition_changed';
  END IF;
  EXECUTE v_new;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_phone_verified_order()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND (auth.uid() IS NULL OR NEW.user_id IS DISTINCT FROM auth.uid()) THEN
    RAISE EXCEPTION 'checkout_not_owned';
  END IF;
  IF NOT public.customer_is_active_email_verified(NEW.user_id) THEN
    RAISE EXCEPTION 'email_verification_required';
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.enforce_phone_verified_booking()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND (auth.uid() IS NULL OR NEW.customer_id IS DISTINCT FROM auth.uid()) THEN
    RAISE EXCEPTION 'booking_not_owned';
  END IF;
  IF NOT public.customer_is_active_email_verified(NEW.customer_id) THEN
    RAISE EXCEPTION 'email_verification_required';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_phone_verified_order(), public.enforce_phone_verified_booking() FROM PUBLIC, anon, authenticated;

INSERT INTO public.capabilities(key,category,risk_level,customer_visible,manually_assignable)
VALUES ('wallet.top_up','wallet','high',true,false) ON CONFLICT(key) DO NOTHING;
INSERT INTO public.entitlement_policies(key,capability_key,name,scope)
VALUES ('builtin.wallet.top_up','wallet.top_up','Wallet top-up','customer') ON CONFLICT(key) DO NOTHING;

DO $$
DECLARE p RECORD; old_version public.entitlement_policy_versions%ROWTYPE; new_id UUID; next_version INTEGER;
BEGIN
  FOR p IN SELECT * FROM public.entitlement_policies WHERE key IN
    ('builtin.commerce.purchase','builtin.commerce.booking','builtin.commerce.checkout','builtin.wallet.top_up') LOOP
    SELECT * INTO old_version FROM public.entitlement_policy_versions WHERE policy_id=p.id AND status='active' FOR UPDATE;
    IF p.key <> 'builtin.wallet.top_up' AND (old_version.id IS NULL OR old_version.effect <> 'allow') THEN
      RAISE EXCEPTION 'commerce_policy_preflight_required: %', p.key;
    END IF;
    IF old_version.id IS NOT NULL AND p.key <> 'builtin.wallet.top_up' AND EXISTS (
      SELECT 1 FROM public.entitlement_policy_requirements WHERE policy_version_id=old_version.id
      AND (fact_key NOT IN ('email_verified','phone_verified') OR operator <> 'eq' OR expected_value <> 'true'::jsonb)
    ) THEN RAISE EXCEPTION 'custom_commerce_policy_preflight_required: %', p.key; END IF;
    SELECT coalesce(max(version),0)+1 INTO next_version FROM public.entitlement_policy_versions WHERE policy_id=p.id;
    INSERT INTO public.entitlement_policy_versions(policy_id,version,status,effect,effective_from)
      VALUES(p.id,next_version,'draft','allow',now()) RETURNING id INTO new_id;
    INSERT INTO public.entitlement_policy_requirements(policy_version_id,alternative_group,fact_key,operator,expected_value)
      VALUES(new_id,1,'email_verified','eq','true'::jsonb);
    IF p.key='builtin.wallet.top_up' THEN
      INSERT INTO public.entitlement_policy_requirements(policy_version_id,alternative_group,fact_key,operator,expected_value)
        VALUES(new_id,1,'phone_verified','eq','true'::jsonb);
    END IF;
    UPDATE public.entitlement_policy_versions SET status='retired' WHERE id=old_version.id;
    UPDATE public.entitlement_policy_versions SET status='active',activated_at=now() WHERE id=new_id;
  END LOOP;
  PERFORM public.increment_entitlement_generation();
END;
$$;
