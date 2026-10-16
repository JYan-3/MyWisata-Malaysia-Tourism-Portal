BEGIN;
SET LOCAL request.jwt.claims = '{"role":"service_role"}';
DO $$
DECLARE
  u uuid; v uuid; outlet uuid; loc uuid; camp uuid; click uuid; o uuid;
  pend_before bigint; pend_after bigint; s record; n integer;
BEGIN
  SELECT id INTO v FROM public.vendors WHERE owner_id IS NOT NULL ORDER BY id LIMIT 1;
  SELECT id INTO outlet FROM public.outlets WHERE vendor_id = v ORDER BY id LIMIT 1;
  SELECT id INTO u FROM public.users WHERE email_verified_at IS NOT NULL AND phone_verified_at IS NOT NULL AND status = 'active' ORDER BY id LIMIT 1;
  SELECT id, campaign_id INTO loc, camp FROM public.promotion_campaign_locations ORDER BY id LIMIT 1;
  SELECT id INTO click FROM public.affiliate_clicks ORDER BY id LIMIT 1;
  IF outlet IS NULL OR u IS NULL OR loc IS NULL OR click IS NULL THEN RAISE EXCEPTION 'test_fixtures_unavailable'; END IF;
  UPDATE public.vendors SET fee_tier_rank = 1, fee_tier_pinned = NULL WHERE id = v;
  INSERT INTO public.wallets (user_id) SELECT owner_id FROM public.vendors WHERE id = v ON CONFLICT (user_id) DO NOTHING;
  SELECT pending_earnings_sen INTO pend_before FROM public.wallets w JOIN public.vendors x ON x.owner_id = w.user_id WHERE x.id = v;

  -- 1. Seed default: percent of the current global rate, identical to before.
  UPDATE public.vendor_fee_tiers SET fee_type = 'percent', percent_rate = 0.15, fixed_per_item_sen = NULL WHERE rank = 1;
  INSERT INTO public.orders(user_id,status,subtotal,total_amount) VALUES(u,'pending_payment',60,60) RETURNING id INTO o;
  INSERT INTO public.order_items(order_id,vendor_id,outlet_id,product_name,unit_price,quantity,line_total) VALUES(o,v,outlet,'Fee test pct',20,3,60);
  INSERT INTO public.payments(order_id,method,provider,amount,status,is_live) VALUES(o,'stripe_card','stripe',60,'succeeded',TRUE);
  UPDATE public.orders SET status='paid', paid_at=now() WHERE id=o;
  SELECT * INTO s FROM public.order_settlements WHERE order_id=o;
  IF s.platform_fee_sen <> 900 OR s.fee_type <> 'percent' OR s.fee_tier_rank <> 1 OR s.item_count <> 3 OR s.base_fee_sen <> 900 THEN
    RAISE EXCEPTION 'percent_tier_wrong %', row_to_json(s); END IF;

  -- 2. Fixed RM1 per item: 3 items -> RM3.
  UPDATE public.vendor_fee_tiers SET fee_type = 'fixed', percent_rate = NULL, fixed_per_item_sen = 100 WHERE rank = 1;
  INSERT INTO public.orders(user_id,status,subtotal,total_amount) VALUES(u,'pending_payment',60,60) RETURNING id INTO o;
  INSERT INTO public.order_items(order_id,vendor_id,outlet_id,product_name,unit_price,quantity,line_total) VALUES(o,v,outlet,'Fee test fixed',20,3,60);
  INSERT INTO public.payments(order_id,method,provider,amount,status,is_live) VALUES(o,'stripe_card','stripe',60,'succeeded',TRUE);
  UPDATE public.orders SET status='paid', paid_at=now() WHERE id=o;
  SELECT * INTO s FROM public.order_settlements WHERE order_id=o;
  IF s.platform_fee_sen <> 300 OR s.vendor_net_sen <> 5700 OR s.fee_type <> 'fixed' OR s.fee_per_item_sen <> 100 OR s.platform_rate <> 0 THEN
    RAISE EXCEPTION 'fixed_tier_wrong %', row_to_json(s); END IF;

  -- 3. Fixed fee never exceeds the sale.
  INSERT INTO public.orders(user_id,status,subtotal,total_amount) VALUES(u,'pending_payment',1,1) RETURNING id INTO o;
  INSERT INTO public.order_items(order_id,vendor_id,outlet_id,product_name,unit_price,quantity,line_total) VALUES(o,v,outlet,'Fee test cap',0.5,2,1);
  INSERT INTO public.payments(order_id,method,provider,amount,status,is_live) VALUES(o,'stripe_card','stripe',1,'succeeded',TRUE);
  UPDATE public.orders SET status='paid', paid_at=now() WHERE id=o;
  SELECT * INTO s FROM public.order_settlements WHERE order_id=o;
  IF s.platform_fee_sen <> 100 OR s.vendor_net_sen <> 0 THEN RAISE EXCEPTION 'fixed_cap_wrong %', row_to_json(s); END IF;

  -- 4. Event line pays the campaign fee per item, the outlet line the tier: 2x50 + 1x100.
  UPDATE public.promotion_campaigns SET platform_fee_per_item_sen = 50 WHERE id = camp;
  INSERT INTO public.orders(user_id,status,subtotal,total_amount) VALUES(u,'pending_payment',30,30) RETURNING id INTO o;
  INSERT INTO public.order_items(order_id,vendor_id,event_location_id,pickup_date,product_name,unit_price,quantity,line_total) VALUES(o,v,loc,current_date,'Fee test event',10,2,20);
  INSERT INTO public.order_items(order_id,vendor_id,outlet_id,product_name,unit_price,quantity,line_total) VALUES(o,v,outlet,'Fee test outlet',10,1,10);
  INSERT INTO public.payments(order_id,method,provider,amount,status,is_live) VALUES(o,'stripe_card','stripe',30,'succeeded',TRUE);
  UPDATE public.orders SET status='paid', paid_at=now() WHERE id=o;
  SELECT * INTO s FROM public.order_settlements WHERE order_id=o;
  IF s.platform_fee_sen <> 200 OR s.fee_source <> 'mixed' OR s.fee_per_item_sen IS NOT NULL OR s.item_count <> 3 THEN
    RAISE EXCEPTION 'event_fee_wrong %', row_to_json(s); END IF;

  -- 5. Event-only order with a percent tier: event fee ignores the tier.
  UPDATE public.vendor_fee_tiers SET fee_type = 'percent', percent_rate = 0.15, fixed_per_item_sen = NULL WHERE rank = 1;
  INSERT INTO public.orders(user_id,status,subtotal,total_amount) VALUES(u,'pending_payment',20,20) RETURNING id INTO o;
  INSERT INTO public.order_items(order_id,vendor_id,event_location_id,pickup_date,product_name,unit_price,quantity,line_total) VALUES(o,v,loc,current_date,'Fee test event only',10,2,20);
  INSERT INTO public.payments(order_id,method,provider,amount,status,is_live) VALUES(o,'stripe_card','stripe',20,'succeeded',TRUE);
  UPDATE public.orders SET status='paid', paid_at=now() WHERE id=o;
  SELECT * INTO s FROM public.order_settlements WHERE order_id=o;
  IF s.platform_fee_sen <> 100 OR s.fee_source <> 'event' OR s.fee_type <> 'fixed' OR s.fee_tier_rank IS NOT NULL THEN
    RAISE EXCEPTION 'event_only_wrong %', row_to_json(s); END IF;

  -- 6. Floor: 1% fee on RM100 (RM1) but RM5 affiliate payout -> fee RM5, held earnings follow.
  UPDATE public.vendor_fee_tiers SET percent_rate = 0.01 WHERE rank = 1;
  INSERT INTO public.orders(user_id,status,subtotal,total_amount) VALUES(u,'pending_payment',100,100) RETURNING id INTO o;
  INSERT INTO public.order_items(order_id,vendor_id,outlet_id,product_name,unit_price,quantity,line_total) VALUES(o,v,outlet,'Fee test floor',100,1,100);
  INSERT INTO public.payments(order_id,method,provider,amount,status,is_live) VALUES(o,'stripe_card','stripe',100,'succeeded',TRUE);
  UPDATE public.orders SET status='paid', paid_at=now() WHERE id=o;
  SELECT pending_earnings_sen INTO pend_after FROM public.wallets w JOIN public.vendors x ON x.owner_id = w.user_id WHERE x.id = v;
  INSERT INTO public.affiliate_attributions(click_id,order_id,commission_rate,commission_amount,status) VALUES(click,o,0.05,5,'pending');
  PERFORM public.apply_order_platform_fee_floor(o);
  PERFORM public.apply_order_platform_fee_floor(o); -- idempotent
  SELECT * INTO s FROM public.order_settlements WHERE order_id=o;
  IF s.platform_fee_sen <> 500 OR s.base_fee_sen <> 100 OR s.vendor_net_sen <> 9500 OR s.payout_floor_sen <> 500 THEN
    RAISE EXCEPTION 'floor_wrong %', row_to_json(s); END IF;
  IF (SELECT pending_earnings_sen FROM public.wallets w JOIN public.vendors x ON x.owner_id = w.user_id WHERE x.id = v) <> pend_after - 400 THEN
    RAISE EXCEPTION 'floor_wallet_wrong'; END IF;
  UPDATE public.affiliate_attributions SET status = 'rejected' WHERE order_id = o;
  PERFORM public.apply_order_platform_fee_floor(o);
  SELECT * INTO s FROM public.order_settlements WHERE order_id=o;
  IF s.platform_fee_sen <> 100 OR s.vendor_net_sen <> 9900 THEN RAISE EXCEPTION 'floor_release_wrong %', row_to_json(s); END IF;
  IF (SELECT pending_earnings_sen FROM public.wallets w JOIN public.vendors x ON x.owner_id = w.user_id WHERE x.id = v) <> pend_after THEN
    RAISE EXCEPTION 'floor_release_wallet_wrong'; END IF;

  -- 7. Refund still claws back the (fee-adjusted) net.
  UPDATE public.orders SET status='refunded' WHERE id=o;
  IF (SELECT pending_earnings_sen FROM public.wallets w JOIN public.vendors x ON x.owner_id = w.user_id WHERE x.id = v) <> pend_after - 9900 THEN
    RAISE EXCEPTION 'refund_wrong'; END IF;

  -- 8. Editing a tier never re-prices past settlements.
  SELECT count(*) INTO n FROM public.order_settlements os JOIN public.order_items oi ON oi.order_id = os.order_id
   WHERE oi.product_name = 'Fee test pct' AND os.platform_fee_sen = 900;
  IF n <> 1 THEN RAISE EXCEPTION 'history_changed'; END IF;

  -- 9. Nightly placement moves the vendor up, a pin overrides it.
  UPDATE public.vendor_fee_tiers SET min_sales_sen = 1 WHERE rank = 2;
  UPDATE public.vendor_fee_tiers SET min_sales_sen = 999999999 WHERE rank = 3;
  PERFORM public.recompute_vendor_fee_tiers();
  IF (SELECT fee_tier_rank FROM public.vendors WHERE id = v) <> 2 THEN RAISE EXCEPTION 'placement_wrong'; END IF;
  UPDATE public.vendors SET fee_tier_pinned = 3 WHERE id = v;
  UPDATE public.vendor_fee_tiers SET percent_rate = 0.10 WHERE rank = 3;
  INSERT INTO public.orders(user_id,status,subtotal,total_amount) VALUES(u,'pending_payment',10,10) RETURNING id INTO o;
  INSERT INTO public.order_items(order_id,vendor_id,outlet_id,product_name,unit_price,quantity,line_total) VALUES(o,v,outlet,'Fee test pin',10,1,10);
  INSERT INTO public.payments(order_id,method,provider,amount,status,is_live) VALUES(o,'stripe_card','stripe',10,'succeeded',TRUE);
  UPDATE public.orders SET status='paid', paid_at=now() WHERE id=o;
  SELECT * INTO s FROM public.order_settlements WHERE order_id=o;
  IF s.platform_fee_sen <> 100 OR s.fee_tier_rank <> 3 THEN RAISE EXCEPTION 'pin_wrong %', row_to_json(s); END IF;

  IF pend_before IS NULL THEN RAISE EXCEPTION 'wallet_missing'; END IF;
END $$;
ROLLBACK;
SELECT 'vendor_platform_fee_tiers_passed' AS result;
