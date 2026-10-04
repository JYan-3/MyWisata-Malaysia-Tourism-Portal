-- Payment provenance is set only by verified server-side provider responses.
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS is_live BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.order_settlements ADD COLUMN IF NOT EXISTS is_simulated BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.mark_checkout_payment_environment(p_checkout_session_id UUID, p_provider_payment_id TEXT, p_is_live BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'service_role_required'; END IF;
  UPDATE public.payments p SET is_live = COALESCE(p_is_live, FALSE)
  FROM public.checkout_sessions c
  WHERE c.id = p_checkout_session_id AND p.order_id = c.order_id
    AND p.provider = 'stripe' AND p.provider_payment_id = p_provider_payment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'verified_payment_not_found'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.mark_checkout_payment_environment(UUID,TEXT,BOOLEAN) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mark_checkout_payment_environment(UUID,TEXT,BOOLEAN) TO service_role;

-- Extend deployed functions rather than replacing their current accounting rules.
DO $migration$
DECLARE d TEXT;
BEGIN
  d := pg_get_functiondef('public.settle_order_vendor_earnings(uuid)'::regprocedure);
  d := replace(d, 'v_settled      INT := 0;', 'v_settled      INT := 0; v_simulated BOOLEAN;');
  d := replace(d, 'v_total_sen := ROUND(v_order.total_amount * 100)::BIGINT;', $patch$
  IF NOT EXISTS (SELECT 1 FROM public.payments WHERE order_id = p_order_id AND status = 'succeeded') THEN
    RETURN jsonb_build_object('settled', 0, 'reason', 'successful_payment_missing');
  END IF;
  v_simulated := NOT EXISTS (SELECT 1 FROM public.payments WHERE order_id = p_order_id AND status = 'succeeded' AND is_live);
  v_total_sen := ROUND(v_order.total_amount * 100)::BIGINT;
$patch$);
  d := replace(d, 'status, hold_until)', 'status, hold_until, is_simulated)');
  d := replace(d, '''pending'', now() + (v_hold_days || '' days'')::INTERVAL)', '''pending'', now() + (v_hold_days || '' days'')::INTERVAL, v_simulated)');
  d := replace(d, 'IF v_net_sen <= 0 THEN', 'IF v_simulated OR v_net_sen <= 0 THEN');
  IF position('v_simulated BOOLEAN' IN d) = 0 OR position('INTERVAL, v_simulated)' IN d) = 0 THEN RAISE EXCEPTION 'settlement_definition_drift'; END IF;
  EXECUTE d;

  d := pg_get_functiondef('public.clear_matured_vendor_settlements(boolean)'::regprocedure);
  d := replace(d, 'WHERE s.status = ''pending''', 'WHERE s.status = ''pending'' AND NOT s.is_simulated');
  IF position('AND NOT s.is_simulated' IN d) = 0 THEN RAISE EXCEPTION 'clearance_definition_drift'; END IF;
  EXECUTE d;

  d := pg_get_functiondef('public.reverse_order_vendor_settlement(uuid,bigint)'::regprocedure);
  d := replace(d, 's.status IN (''pending'', ''confirmed'')', 's.status IN (''pending'', ''confirmed'') AND NOT s.is_simulated');
  IF position('AND NOT s.is_simulated' IN d) = 0 THEN RAISE EXCEPTION 'reversal_definition_drift'; END IF;
  EXECUTE d;
END $migration$;

-- This runs in the payment transaction, even if the browser closes immediately.
CREATE OR REPLACE FUNCTION public.sync_paid_order_vendor_settlement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.status IN ('paid','completed') AND OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM public.settle_order_vendor_earnings(NEW.id);
  END IF;
  IF NEW.status = 'refunded' AND OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM public.reverse_order_vendor_settlement(NEW.id, NULL);
    UPDATE public.order_settlements SET status='reversed', reversed_amount_sen=vendor_net_sen, reversed_at=now()
      WHERE order_id=NEW.id AND is_simulated AND status <> 'reversed';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sync_paid_order_vendor_settlement() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS order_vendor_settlement_sync ON public.orders;
CREATE TRIGGER order_vendor_settlement_sync AFTER UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.sync_paid_order_vendor_settlement();
