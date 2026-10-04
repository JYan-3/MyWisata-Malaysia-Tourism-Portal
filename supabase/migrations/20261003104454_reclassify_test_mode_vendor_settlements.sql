-- Test-mode charges are not vendor income. Reverse any legacy settlement
-- before marking it simulated so existing confirmed wallet credits are clawed
-- back through the existing locked, audited settlement function.
DO $migration$
DECLARE
  v_order_id UUID;
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
      AND s.is_simulated
      AND (
        s.status <> 'reversed'
        OR s.reversed_amount_sen < s.vendor_net_sen
      )
  ) THEN
    RAISE EXCEPTION 'simulated_settlement_has_incomplete_prior_clawback';
  END IF;

  FOR v_order_id IN
    SELECT DISTINCT s.order_id
    FROM public.order_settlements s
    JOIN public.payments p ON p.order_id = s.order_id AND p.status = 'succeeded'
    WHERE NOT s.is_simulated
      AND s.status IN ('pending', 'confirmed')
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
  LOOP
    PERFORM public.reverse_order_vendor_settlement(v_order_id, NULL);

    IF EXISTS (
      SELECT 1 FROM public.order_settlements s
      WHERE s.order_id = v_order_id
        AND NOT s.is_simulated
        AND (s.status <> 'reversed' OR s.reversed_amount_sen < s.vendor_net_sen)
    ) THEN
      RAISE EXCEPTION 'simulated_settlement_clawback_incomplete for order %', v_order_id;
    END IF;

    INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, before_data, after_data, note)
    SELECT NULL,
      'order.vendor_settlement.reclassified_simulated',
      'order_settlement',
      v_order_id,
      jsonb_build_object('is_simulated', FALSE),
      jsonb_build_object('is_simulated', TRUE, 'status', 'reversed', 'reversed_amount_sen',
        COALESCE(jsonb_agg(jsonb_build_object('vendor_id', s.vendor_id, 'amount_sen', s.reversed_amount_sen)), '[]'::jsonb)),
      'Reversed historical earnings backed only by an explicit test-mode or simulator payment.'
    FROM public.order_settlements s
    WHERE s.order_id = v_order_id;

    UPDATE public.order_settlements
    SET is_simulated = TRUE
    WHERE order_id = v_order_id;
  END LOOP;

  -- Rows already reversed by the legacy flow need only the provenance flag.
  UPDATE public.order_settlements s
  SET is_simulated = TRUE
  WHERE NOT s.is_simulated
    AND s.status = 'reversed'
    AND s.reversed_amount_sen >= s.vendor_net_sen
    AND EXISTS (
      SELECT 1 FROM public.payments p
      WHERE p.order_id = s.order_id
        AND p.status = 'succeeded'
        AND NOT EXISTS (
          SELECT 1 FROM public.payments live_payment
          WHERE live_payment.order_id = p.order_id
            AND live_payment.status = 'succeeded'
            AND live_payment.is_live
        )
        AND (
          (p.provider = 'stripe' AND p.provider_payment_id LIKE 'cs_test_%')
          OR p.provider IN ('tng_ewallet_simulator', 'grabpay_simulator', 'bank_transfer_simulator', 'demo')
          OR p.method = 'mock_card'
        )
    );
END;
$migration$;
