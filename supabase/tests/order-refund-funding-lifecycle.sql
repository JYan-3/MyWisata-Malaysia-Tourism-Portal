BEGIN;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
DO $$
DECLARE
  v_user UUID;
  v_cart UUID;
  v_vendor UUID;
  v_outlet UUID;
  v_wallet UUID;
  v_order UUID;
  v_checkout UUID := gen_random_uuid();
  v_payment UUID;
  v_refund UUID;
  v_before_topup BIGINT;
  v_before_earnings BIGINT;
  v_after_topup BIGINT;
  v_after_earnings BIGINT;
  v_count INTEGER;
  v_result JSONB;
BEGIN
  SELECT u.id,c.id INTO v_user,v_cart
    FROM public.users u JOIN public.carts c ON c.user_id=u.id
   WHERE u.email_verified_at IS NOT NULL AND u.phone_verified_at IS NOT NULL AND u.status='active'
   ORDER BY u.id LIMIT 1;
  SELECT v.id,o.id INTO v_vendor,v_outlet
    FROM public.vendors v JOIN public.outlets o ON o.vendor_id=v.id
   WHERE v.owner_id IS NOT NULL ORDER BY v.id,o.id LIMIT 1;
  IF v_user IS NULL OR v_cart IS NULL OR v_outlet IS NULL THEN RAISE EXCEPTION 'refund_test_fixtures_unavailable'; END IF;

  INSERT INTO public.wallets(user_id) VALUES(v_user) ON CONFLICT(user_id) DO NOTHING;
  SELECT id INTO v_wallet FROM public.wallets WHERE user_id=v_user FOR UPDATE;
  UPDATE public.wallets SET topup_sen=topup_sen+700,earnings_sen=earnings_sen+600 WHERE id=v_wallet;
  SELECT topup_sen,earnings_sen INTO v_before_topup,v_before_earnings FROM public.wallets WHERE id=v_wallet;

  INSERT INTO public.orders(user_id,status,subtotal,total_amount,payment_method,paid_at)
    VALUES(v_user,'paid',28,28,'wallet_split',NOW()) RETURNING id INTO v_order;
  INSERT INTO public.order_items(order_id,vendor_id,outlet_id,product_name,unit_price,quantity,line_total)
    VALUES(v_order,v_vendor,v_outlet,'Refund funding rollback fixture',28,1,28);
  INSERT INTO public.checkout_sessions(id,user_id,cart_id,order_id,payment_method,idempotency_key,request_hash,subtotal,total_amount,status)
    VALUES(v_checkout,v_user,v_cart,v_order,'wallet_split','refund-test-'||v_checkout::TEXT,'refund-test',28,28,'paid');
  INSERT INTO public.checkout_wallet_reservations(checkout_session_id,user_id,wallet_id,topup_amount_sen,earnings_amount_sen,status,idempotency_key)
    VALUES(v_checkout,v_user,v_wallet,700,600,'committed','refund-wallet-test-'||v_checkout::TEXT);
  UPDATE public.wallets SET topup_sen=topup_sen-700,earnings_sen=earnings_sen-600 WHERE id=v_wallet;
  INSERT INTO public.wallet_transactions(user_id,wallet_id,order_id,idempotency_key,type,amount_sen,bucket,direction,note)
    VALUES(v_user,v_wallet,v_order,'wallet-split-reserve:'||v_checkout::TEXT||':topup','spend',700,'topup','debit','Rollback refund fixture');
  INSERT INTO public.wallet_transactions(user_id,wallet_id,order_id,idempotency_key,type,amount_sen,bucket,direction,note)
    VALUES(v_user,v_wallet,v_order,'wallet-split-reserve:'||v_checkout::TEXT||':earnings','spend',600,'earnings','debit','Rollback refund fixture');
  INSERT INTO public.payments(order_id,method,provider,provider_payment_id,amount,status)
    VALUES(v_order,'wallet_split','stripe','cs_refund_rollback_fixture',15,'succeeded') RETURNING id INTO v_payment;

  v_result := public.request_order_refund(v_order,v_user,'Rollback split refund test');
  v_refund := (v_result->>'id')::UUID;
  IF (v_result->>'wallet_topup_sen')::BIGINT<>700
     OR (v_result->>'wallet_earnings_sen')::BIGINT<>600
     OR (v_result->>'external_amount_sen')::BIGINT<>1500 THEN
    RAISE EXCEPTION 'refund_source_allocation_incorrect';
  END IF;

  v_result := public.record_order_refund_provider_outcome(v_refund,'re_refund_rollback_fixture','pending',1500,'MYR');
  SELECT topup_sen,earnings_sen INTO v_after_topup,v_after_earnings FROM public.wallets WHERE id=v_wallet;
  IF v_result->>'status'<>'approved' OR v_after_topup<>v_before_topup-700 OR v_after_earnings<>v_before_earnings-600 THEN
    RAISE EXCEPTION 'pending_provider_refund_changed_wallet';
  END IF;
  IF (SELECT status FROM public.orders WHERE id=v_order)<>'paid' THEN RAISE EXCEPTION 'pending_provider_refund_changed_order'; END IF;

  v_result := public.record_order_refund_provider_outcome(v_refund,'re_refund_rollback_fixture','succeeded',1500,'MYR');
  SELECT topup_sen,earnings_sen INTO v_after_topup,v_after_earnings FROM public.wallets WHERE id=v_wallet;
  IF v_result->>'status'<>'processed' OR v_after_topup<>v_before_topup OR v_after_earnings<>v_before_earnings THEN
    RAISE EXCEPTION 'successful_provider_refund_did_not_restore_original_buckets';
  END IF;
  IF (SELECT status FROM public.orders WHERE id=v_order)<>'refunded'
     OR (SELECT status FROM public.payments WHERE id=v_payment)<>'refunded' THEN
    RAISE EXCEPTION 'successful_provider_refund_did_not_close_order';
  END IF;
  PERFORM public.record_order_refund_provider_outcome(v_refund,'re_refund_rollback_fixture','succeeded',1500,'MYR');
  SELECT count(*) INTO v_count FROM public.wallet_transactions
   WHERE order_id=v_order AND type='refund' AND direction='credit';
  IF v_count<>2 THEN RAISE EXCEPTION 'refund_wallet_credit_not_idempotent'; END IF;
END $$;
ROLLBACK;
SELECT 'split_refund_pending_success_wallet_restore_and_idempotency_passed' AS result;
