-- Read-only acceptance check: test-mode order earnings must never remain live.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.order_settlements s
    JOIN public.payments p ON p.order_id = s.order_id AND p.status = 'succeeded'
    WHERE NOT EXISTS (
      SELECT 1 FROM public.payments live_payment
      WHERE live_payment.order_id = s.order_id
        AND live_payment.status = 'succeeded'
        AND live_payment.is_live
    )
      AND (
        (p.provider = 'stripe' AND p.provider_payment_id LIKE 'cs_test_%')
        OR p.provider IN ('tng_ewallet_simulator', 'grabpay_simulator', 'bank_transfer_simulator', 'demo')
        OR p.method = 'mock_card'
      )
      AND (
        NOT s.is_simulated
        OR s.status <> 'reversed'
        OR s.reversed_amount_sen < s.vendor_net_sen
      )
  ) THEN
    RAISE EXCEPTION 'test_mode_settlement_still_counted_as_live';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.order_settlements s
    JOIN public.payments p ON p.order_id = s.order_id AND p.status = 'succeeded'
    WHERE s.is_simulated
      AND s.created_at < TIMESTAMPTZ '2026-10-03 10:44:54+00'
      AND (p.provider = 'stripe' AND p.provider_payment_id LIKE 'cs_test_%')
      AND NOT EXISTS (
        SELECT 1 FROM public.audit_logs a
        WHERE a.entity_id = s.order_id
          AND a.action = 'order.vendor_settlement.reclassified_simulated'
      )
  ) THEN
    RAISE EXCEPTION 'simulated_settlement_reclassification_missing_audit';
  END IF;

  IF EXISTS (
    SELECT wt.order_id
    FROM public.wallet_transactions wt
    JOIN public.order_settlements s ON s.order_id = wt.order_id
    JOIN public.payments p ON p.order_id = s.order_id AND p.status = 'succeeded'
    WHERE wt.bucket IN ('earnings', 'pending_earnings')
      AND NOT EXISTS (
        SELECT 1 FROM public.payments live_payment
        WHERE live_payment.order_id = s.order_id
          AND live_payment.status = 'succeeded'
          AND live_payment.is_live
      )
      AND (
        (p.provider = 'stripe' AND p.provider_payment_id LIKE 'cs_test_%')
        OR p.provider IN ('tng_ewallet_simulator', 'grabpay_simulator', 'bank_transfer_simulator', 'demo')
        OR p.method = 'mock_card'
      )
    GROUP BY wt.order_id
    HAVING SUM(CASE WHEN wt.direction = 'credit' THEN wt.amount_sen ELSE -wt.amount_sen END) > 0
  ) THEN
    RAISE EXCEPTION 'test_mode_earnings_remain_withdrawable';
  END IF;
END $$;

SELECT 'simulated_settlement_provenance_passed' AS result;
