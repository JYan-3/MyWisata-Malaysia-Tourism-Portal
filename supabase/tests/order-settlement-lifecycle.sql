BEGIN;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
DO $$
DECLARE u uuid; v uuid; outlet uuid; o uuid; before_balance bigint; after_balance bigint; n integer; live_order uuid;
BEGIN
  SELECT id INTO v FROM public.vendors WHERE owner_id IS NOT NULL ORDER BY id LIMIT 1;
  SELECT id INTO outlet FROM public.outlets WHERE vendor_id=v ORDER BY id LIMIT 1;
  SELECT id INTO u FROM public.users WHERE email_verified_at IS NOT NULL AND phone_verified_at IS NOT NULL AND status='active' ORDER BY id LIMIT 1;
  IF outlet IS NULL OR u IS NULL THEN RAISE EXCEPTION 'verified_test_fixtures_unavailable'; END IF;
  SELECT COALESCE(sum(pending_earnings_sen),0) INTO before_balance FROM public.wallets;
  INSERT INTO public.orders(user_id,status,subtotal,total_amount) VALUES(u,'pending_payment',1,1) RETURNING id INTO o;
  INSERT INTO public.order_items(order_id,vendor_id,outlet_id,product_name,unit_price,quantity,line_total) VALUES(o,v,outlet,'Rollback settlement test',1,1,1);
  INSERT INTO public.payments(order_id,method,provider,amount,status,is_live) VALUES(o,'mock_card','demo',1,'succeeded',FALSE);
  UPDATE public.orders SET status='paid',paid_at=now() WHERE id=o;
  SELECT count(*) INTO n FROM public.order_settlements WHERE order_id=o AND is_simulated;
  IF n <> 1 THEN RAISE EXCEPTION 'simulated_settlement_missing'; END IF;
  SELECT COALESCE(sum(pending_earnings_sen),0) INTO after_balance FROM public.wallets;
  IF before_balance <> after_balance THEN RAISE EXCEPTION 'mock_payment_credited_real_wallet'; END IF;
  PERFORM public.settle_order_vendor_earnings(o);
  SELECT count(*) INTO n FROM public.order_settlements WHERE order_id=o;
  IF n <> 1 THEN RAISE EXCEPTION 'duplicate_settlement'; END IF;

  INSERT INTO public.orders(user_id,status,subtotal,total_amount) VALUES(u,'pending_payment',1,1) RETURNING id INTO live_order;
  INSERT INTO public.order_items(order_id,vendor_id,outlet_id,product_name,unit_price,quantity,line_total) VALUES(live_order,v,outlet,'Rollback verified payment test',1,1,1);
  INSERT INTO public.payments(order_id,method,provider,amount,status,is_live) VALUES(live_order,'stripe_card','stripe',1,'succeeded',TRUE);
  UPDATE public.orders SET status='paid',paid_at=now() WHERE id=live_order;
  SELECT count(*) INTO n FROM public.order_settlements WHERE order_id=live_order AND NOT is_simulated AND wallet_txn_id IS NOT NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'verified_payment_settlement_missing'; END IF;
  PERFORM public.settle_order_vendor_earnings(live_order);
  SELECT count(*) INTO n FROM public.wallet_transactions WHERE order_id=live_order AND type='earnings_pending';
  IF n <> 1 THEN RAISE EXCEPTION 'duplicate_wallet_credit'; END IF;
  UPDATE public.orders SET status='refunded' WHERE id=live_order;
  SELECT COALESCE(sum(pending_earnings_sen),0) INTO after_balance FROM public.wallets;
  IF before_balance <> after_balance THEN RAISE EXCEPTION 'refund_settlement_not_reversed'; END IF;
END $$;
ROLLBACK;
SELECT 'paid_order_settlement_simulation_isolation_idempotency_and_reversal_passed' AS result;
