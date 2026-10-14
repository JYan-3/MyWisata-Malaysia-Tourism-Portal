-- Read-only installed-function baseline captured during the approved audit.
-- Used only in the disposable loopback test database. No production rows.
CREATE OR REPLACE FUNCTION public.finalize_checkout(p_checkout_session_id uuid, p_outcome text, p_provider_payment_id text DEFAULT NULL::text, p_provider_event_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_session checkout_sessions%ROWTYPE;
  v_reservation RECORD;
  v_hold voucher_holds%ROWTYPE;
  v_payment_id UUID;
  v_wallet wallets%ROWTYPE;
  v_total_sen BIGINT;
  v_topup_sen BIGINT;
  v_earnings_sen BIGINT;
BEGIN
  IF v_user IS NULL AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'checkout_auth_required';
  END IF;

  SELECT * INTO v_session
    FROM public.checkout_sessions
   WHERE id = p_checkout_session_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'checkout_session_not_found'; END IF;
  IF v_user IS NOT NULL AND v_user IS DISTINCT FROM v_session.user_id AND NOT is_admin(v_user) THEN
    RAISE EXCEPTION 'checkout_not_owned';
  END IF;
  IF v_session.status = 'paid' THEN
    RETURN jsonb_build_object('checkout_session_id', v_session.id, 'order_id', v_session.order_id, 'status', 'paid');
  END IF;
  IF v_session.status IN ('failed', 'expired', 'cancelled') THEN
    RETURN jsonb_build_object('checkout_session_id', v_session.id, 'order_id', v_session.order_id, 'status', v_session.status);
  END IF;

  SELECT id INTO v_payment_id
    FROM public.payments
   WHERE order_id = v_session.order_id
   ORDER BY created_at DESC
   LIMIT 1
   FOR UPDATE;

  IF lower(p_outcome) IN ('failed', 'cancelled', 'expired') THEN
    FOR v_reservation IN
      SELECT * FROM public.checkout_reservations
       WHERE checkout_session_id = v_session.id AND status = 'held'
    LOOP
      IF v_reservation.kind = 'inventory' THEN
        UPDATE public.inventory
           SET reserved = GREATEST(0, reserved - v_reservation.quantity), updated_at = NOW()
         WHERE variant_id = v_reservation.variant_id AND outlet_id IS NOT DISTINCT FROM v_reservation.outlet_id;
      ELSE
        UPDATE public.booking_slots
           SET booked = GREATEST(0, booked - v_reservation.quantity),
               status = CASE
                 WHEN status = 'full' AND booked - v_reservation.quantity < capacity THEN 'available'
                 ELSE status
               END
         WHERE id = v_reservation.slot_id;
        UPDATE public.bookings
           SET status = 'cancelled', cancelled_at = NOW()
         WHERE order_item_id IN (
           SELECT id FROM public.order_items
            WHERE order_id = v_session.order_id AND slot_id = v_reservation.slot_id
         );
      END IF;
      UPDATE public.checkout_reservations SET status = 'released' WHERE id = v_reservation.id;
    END LOOP;
    SELECT * INTO v_hold
      FROM public.voucher_holds
     WHERE checkout_session_id = v_session.id AND status = 'held'
     FOR UPDATE;
    IF v_hold.id IS NOT NULL THEN
      UPDATE public.vouchers
         SET reserved_uses = GREATEST(0, reserved_uses - 1)
       WHERE id = v_hold.voucher_id;
      UPDATE public.voucher_holds SET status = 'released' WHERE id = v_hold.id;
    END IF;
    UPDATE public.payments
       SET status = CASE WHEN lower(p_outcome) = 'expired' THEN 'cancelled' ELSE 'failed' END,
           failure_reason = p_outcome,
           updated_at = NOW()
     WHERE id = v_payment_id;
    UPDATE public.orders
       SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
     WHERE id = v_session.order_id;
    UPDATE public.checkout_sessions
       SET status = CASE WHEN lower(p_outcome) = 'expired' THEN 'expired' ELSE 'failed' END,
           updated_at = NOW()
     WHERE id = v_session.id;
    RETURN jsonb_build_object('checkout_session_id', v_session.id, 'order_id', v_session.order_id, 'status', 'failed');
  END IF;

  IF lower(p_outcome) <> 'succeeded' THEN RAISE EXCEPTION 'invalid_checkout_outcome'; END IF;

  IF v_session.payment_method = 'wallet' THEN
    SELECT * INTO v_wallet
      FROM public.wallets
     WHERE user_id = v_session.user_id
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'wallet_not_found'; END IF;

    v_total_sen := ROUND(v_session.total_amount * 100)::BIGINT;
    IF v_total_sen <= 0 THEN RAISE EXCEPTION 'invalid_wallet_total'; END IF;
    IF v_wallet.topup_sen + v_wallet.earnings_sen < v_total_sen THEN
      RAISE EXCEPTION 'wallet_insufficient';
    END IF;

    v_topup_sen := LEAST(v_wallet.topup_sen, v_total_sen);
    v_earnings_sen := v_total_sen - v_topup_sen;
    UPDATE public.wallets
       SET topup_sen = topup_sen - v_topup_sen,
           earnings_sen = earnings_sen - v_earnings_sen,
           updated_at = NOW()
     WHERE id = v_wallet.id;

    IF v_topup_sen > 0 THEN
      INSERT INTO public.wallet_transactions
        (user_id, wallet_id, order_id, idempotency_key, type, amount_sen, bucket, direction, note)
      VALUES
        (v_session.user_id, v_wallet.id, v_session.order_id,
         'wallet-spend:' || v_session.id::text || ':topup',
         'spend', v_topup_sen, 'topup', 'debit', 'Wallet checkout payment')
      ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
    END IF;
    IF v_earnings_sen > 0 THEN
      INSERT INTO public.wallet_transactions
        (user_id, wallet_id, order_id, idempotency_key, type, amount_sen, bucket, direction, note)
      VALUES
        (v_session.user_id, v_wallet.id, v_session.order_id,
         'wallet-spend:' || v_session.id::text || ':earnings',
         'spend', v_earnings_sen, 'earnings', 'debit', 'Wallet checkout payment')
      ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
    END IF;
  END IF;

  FOR v_reservation IN
    SELECT * FROM public.checkout_reservations
     WHERE checkout_session_id = v_session.id AND status = 'held'
  LOOP
    IF v_reservation.kind = 'inventory' THEN
      UPDATE public.inventory
         SET quantity = quantity - v_reservation.quantity,
             reserved = GREATEST(0, reserved - v_reservation.quantity),
             updated_at = NOW()
       WHERE variant_id = v_reservation.variant_id
         AND outlet_id IS NOT DISTINCT FROM v_reservation.outlet_id AND quantity >= v_reservation.quantity
         AND reserved >= v_reservation.quantity;
      IF NOT FOUND THEN RAISE EXCEPTION 'inventory_commit_failed'; END IF;
    END IF;
    UPDATE public.checkout_reservations SET status = 'committed' WHERE id = v_reservation.id;
  END LOOP;

  SELECT * INTO v_hold
    FROM public.voucher_holds
   WHERE checkout_session_id = v_session.id AND status = 'held'
   FOR UPDATE;
  IF v_hold.id IS NOT NULL THEN
    UPDATE public.vouchers
       SET reserved_uses = GREATEST(0, reserved_uses - 1), uses_count = uses_count + 1
     WHERE id = v_hold.voucher_id;
    INSERT INTO public.voucher_redemptions(voucher_id, order_id, user_id, discount)
      SELECT v_hold.voucher_id, v_session.order_id, v_hold.user_id, discount_amount
        FROM public.orders WHERE id = v_session.order_id
      ON CONFLICT (voucher_id, order_id) DO NOTHING;
    UPDATE public.voucher_holds SET status = 'committed' WHERE id = v_hold.id;
  END IF;

  UPDATE public.payments
     SET status = 'succeeded',
         provider_payment_id = COALESCE(p_provider_payment_id, provider_payment_id),
         processed_at = NOW(), updated_at = NOW()
   WHERE id = v_payment_id;
  UPDATE public.orders
     SET status = 'paid', paid_at = NOW(), updated_at = NOW()
   WHERE id = v_session.order_id;
  UPDATE public.checkout_sessions
     SET status = 'paid', updated_at = NOW()
   WHERE id = v_session.id;

  DELETE FROM public.cart_items ci
   WHERE ci.cart_id = v_session.cart_id
     AND ci.id IN (
       SELECT reservation.cart_item_id
         FROM public.checkout_reservations reservation
        WHERE reservation.checkout_session_id = v_session.id
          AND reservation.status = 'committed'
          AND reservation.cart_item_id IS NOT NULL
     );

  IF p_provider_event_id IS NOT NULL THEN
    INSERT INTO public.payment_events(provider, provider_event_id, checkout_session_id, order_id, event_type)
    VALUES ('stripe', p_provider_event_id, v_session.id, v_session.order_id, 'checkout.finalized')
    ON CONFLICT (provider, provider_event_id) DO NOTHING;
  END IF;
  RETURN jsonb_build_object('checkout_session_id', v_session.id, 'order_id', v_session.order_id, 'status', 'paid');
END;
$function$
;
CREATE OR REPLACE FUNCTION app_private.finalize_customer_wallet_checkout(p_checkout_session_id uuid, p_outcome text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user UUID := auth.uid();
  v_session public.checkout_sessions%ROWTYPE;
  v_reservation public.checkout_wallet_reservations%ROWTYPE;
  v_payment public.payments%ROWTYPE;
  v_result JSONB;
  v_total_sen BIGINT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'checkout_auth_required'; END IF;
  IF LOWER(COALESCE(p_outcome, '')) NOT IN ('succeeded', 'failed', 'cancelled', 'expired') THEN
    RAISE EXCEPTION 'invalid_checkout_outcome';
  END IF;

  SELECT * INTO v_session
    FROM public.checkout_sessions
   WHERE id = p_checkout_session_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'checkout_session_not_found'; END IF;
  IF v_session.user_id <> v_user THEN RAISE EXCEPTION 'checkout_not_owned'; END IF;

  IF v_session.payment_method = 'wallet_split' THEN
    IF LOWER(COALESCE(p_outcome, '')) <> 'succeeded' THEN
      RAISE EXCEPTION 'provider_confirmation_required';
    END IF;

    SELECT * INTO v_reservation
      FROM public.checkout_wallet_reservations
     WHERE checkout_session_id = p_checkout_session_id
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'provider_confirmation_required'; END IF;

    v_total_sen := ROUND(v_session.total_amount * 100)::BIGINT;
    IF v_reservation.user_id <> v_session.user_id
       OR v_reservation.status <> 'reserved'
       OR v_reservation.topup_amount_sen + v_reservation.earnings_amount_sen <> v_total_sen THEN
      RAISE EXCEPTION 'provider_confirmation_required';
    END IF;

    SELECT * INTO v_payment
      FROM public.payments
     WHERE order_id = v_session.order_id
     ORDER BY created_at DESC
     LIMIT 1
     FOR UPDATE;
    IF NOT FOUND OR v_payment.amount <> 0 THEN
      RAISE EXCEPTION 'provider_confirmation_required';
    END IF;
  ELSIF v_session.payment_method <> 'wallet' THEN
    RAISE EXCEPTION 'provider_confirmation_required';
  END IF;

  v_result := public.finalize_checkout(p_checkout_session_id, LOWER(p_outcome), NULL, NULL);
  IF LOWER(p_outcome) = 'cancelled' THEN
    UPDATE public.checkout_sessions SET status = 'cancelled', updated_at = NOW()
     WHERE id = p_checkout_session_id AND status = 'failed';
    UPDATE public.payments SET status = 'cancelled', failure_reason = 'cancelled', updated_at = NOW()
     WHERE order_id = v_session.order_id AND status = 'failed';
    v_result := v_result || jsonb_build_object('status', 'cancelled');
  END IF;
  RETURN v_result;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.finalize_customer_wallet_checkout(p_checkout_session_id uuid, p_outcome text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT app_private.finalize_customer_wallet_checkout(
    p_checkout_session_id,
    p_outcome
  );
$function$
;
CREATE OR REPLACE FUNCTION public.guest_cancel_checkout(p_checkout_session_id uuid, p_guest_subject_id uuid, p_outcome text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
 IF coalesce(auth.role(),'')<>'service_role' OR p_outcome IS NULL OR p_outcome NOT IN ('failed','cancelled','expired') OR NOT EXISTS(SELECT 1 FROM public.checkout_sessions WHERE id=p_checkout_session_id AND guest_subject_id=p_guest_subject_id AND user_id IS NULL) THEN RAISE EXCEPTION 'checkout_not_owned'; END IF;
 RETURN public.finalize_checkout(p_checkout_session_id,p_outcome,NULL,NULL);
END; $function$
;
CREATE OR REPLACE FUNCTION public.settle_provider_checkout(p_checkout_session_id uuid, p_provider text, p_outcome text, p_provider_payment_id text, p_provider_event_id text, p_payload_sha256 text, p_amount_sen bigint, p_currency text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_session public.checkout_sessions%ROWTYPE;
  v_payment public.payments%ROWTYPE;
  v_event public.payment_events%ROWTYPE;
  v_event_type TEXT;
  v_target_status TEXT;
  v_result JSONB;
  v_expected_amount_sen BIGINT;
  v_inserted INTEGER;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role_required';
  END IF;
  IF p_provider NOT IN ('stripe', 'toyyibpay', 'tng_ewallet_simulator', 'grabpay_simulator', 'bank_transfer_simulator') THEN
    RAISE EXCEPTION 'payment_provider_invalid';
  END IF;
  IF LOWER(COALESCE(p_outcome, '')) NOT IN ('succeeded', 'failed', 'cancelled', 'expired', 'pending') THEN
    RAISE EXCEPTION 'invalid_checkout_outcome';
  END IF;
  IF LOWER(p_outcome) = 'pending' AND p_provider <> 'toyyibpay' THEN
    RAISE EXCEPTION 'invalid_checkout_outcome';
  END IF;
  IF BTRIM(COALESCE(p_provider_payment_id, '')) = '' OR LENGTH(p_provider_payment_id) > 255 THEN
    RAISE EXCEPTION 'provider_payment_id_invalid';
  END IF;
  IF p_provider = 'toyyibpay' AND p_provider_payment_id !~ '^[A-Za-z0-9]{8}$' THEN
    RAISE EXCEPTION 'provider_payment_id_invalid';
  END IF;
  IF BTRIM(COALESCE(p_provider_event_id, '')) = '' OR LENGTH(p_provider_event_id) > 255 THEN
    RAISE EXCEPTION 'provider_event_id_invalid';
  END IF;
  IF COALESCE(p_payload_sha256, '') !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'provider_payload_hash_invalid';
  END IF;
  IF p_amount_sen IS NULL OR p_amount_sen <= 0 THEN RAISE EXCEPTION 'provider_amount_invalid'; END IF;
  IF UPPER(COALESCE(p_currency, '')) <> 'MYR' THEN RAISE EXCEPTION 'provider_currency_invalid'; END IF;

  SELECT * INTO v_session
    FROM public.checkout_sessions
   WHERE id = p_checkout_session_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'checkout_session_not_found'; END IF;

  IF NOT (
    (p_provider = 'stripe' AND v_session.payment_method IN ('stripe_card', 'wallet_split'))
    OR (p_provider = 'toyyibpay' AND v_session.payment_method = 'bank_transfer')
    OR (p_provider IN ('tng_ewallet_simulator', 'grabpay_simulator') AND v_session.payment_method = 'ewallet')
    OR (p_provider = 'bank_transfer_simulator' AND v_session.payment_method = 'bank_transfer')
  ) THEN
    RAISE EXCEPTION 'payment_provider_mismatch';
  END IF;

  SELECT * INTO v_payment
    FROM public.payments
   WHERE order_id = v_session.order_id
   ORDER BY created_at DESC
   LIMIT 1
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'checkout_payment_not_found'; END IF;
  IF v_payment.provider <> p_provider THEN RAISE EXCEPTION 'payment_provider_mismatch'; END IF;
  IF p_provider = 'toyyibpay' AND v_payment.provider_create_status <> 'created' THEN
    RAISE EXCEPTION 'provider_payment_id_invalid';
  END IF;
  IF v_payment.provider_payment_id IS DISTINCT FROM BTRIM(p_provider_payment_id) THEN
    RAISE EXCEPTION 'provider_payment_id_mismatch';
  END IF;
  v_expected_amount_sen := ROUND(v_payment.amount * 100)::BIGINT;
  IF v_expected_amount_sen <> p_amount_sen THEN RAISE EXCEPTION 'provider_amount_mismatch'; END IF;
  IF UPPER(v_session.currency) <> UPPER(p_currency) THEN RAISE EXCEPTION 'provider_currency_mismatch'; END IF;

  v_event_type := 'payment.' || LOWER(p_outcome);
  v_target_status := CASE LOWER(p_outcome)
    WHEN 'succeeded' THEN 'paid'
    WHEN 'failed' THEN 'failed'
    WHEN 'cancelled' THEN 'cancelled'
    WHEN 'pending' THEN 'requires_action'
    ELSE 'expired'
  END;

  SELECT * INTO v_event
    FROM public.payment_events
   WHERE provider = p_provider AND provider_event_id = p_provider_event_id
   FOR UPDATE;
  IF FOUND THEN
    IF v_event.payload_hash IS DISTINCT FROM p_payload_sha256
       OR v_event.checkout_session_id IS DISTINCT FROM v_session.id
       OR v_event.order_id IS DISTINCT FROM v_session.order_id
       OR v_event.event_type IS DISTINCT FROM v_event_type THEN
      RAISE EXCEPTION 'provider_event_conflict';
    END IF;
    RETURN jsonb_build_object(
      'checkout_session_id', v_session.id,
      'order_id', v_session.order_id,
      'user_id', v_session.user_id,
      'status', v_session.status,
      'idempotent', TRUE
    );
  END IF;

  IF LOWER(p_outcome) = 'pending' THEN
    INSERT INTO public.payment_events(
      provider, provider_event_id, checkout_session_id, order_id, event_type, payload_hash
    ) VALUES (
      p_provider, BTRIM(p_provider_event_id), v_session.id, v_session.order_id, v_event_type, p_payload_sha256
    ) ON CONFLICT (provider, provider_event_id) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted = 0 THEN
      SELECT * INTO v_event
        FROM public.payment_events
       WHERE provider = p_provider AND provider_event_id = p_provider_event_id;
      IF v_event.payload_hash IS DISTINCT FROM p_payload_sha256
         OR v_event.checkout_session_id IS DISTINCT FROM v_session.id
         OR v_event.order_id IS DISTINCT FROM v_session.order_id
         OR v_event.event_type IS DISTINCT FROM v_event_type THEN
        RAISE EXCEPTION 'provider_event_conflict';
      END IF;
      RETURN jsonb_build_object(
        'checkout_session_id', v_session.id,
        'order_id', v_session.order_id,
        'user_id', v_session.user_id,
        'status', v_session.status,
        'idempotent', TRUE
      );
    END IF;
    IF v_session.status NOT IN ('paid', 'failed', 'cancelled', 'expired') THEN
      UPDATE public.checkout_sessions
         SET status = 'requires_action', updated_at = NOW()
       WHERE id = v_session.id;
      UPDATE public.payments
         SET status = 'requires_action', updated_at = NOW()
       WHERE id = v_payment.id;
      v_session.status := 'requires_action';
    END IF;
    RETURN jsonb_build_object(
      'checkout_session_id', v_session.id,
      'order_id', v_session.order_id,
      'user_id', v_session.user_id,
      'status', v_session.status,
      'idempotent', FALSE
    );
  END IF;

  IF v_session.status IN ('paid', 'failed', 'cancelled', 'expired')
     AND v_session.status <> v_target_status THEN
    RAISE EXCEPTION 'checkout_terminal_conflict';
  END IF;

  INSERT INTO public.payment_events(
    provider, provider_event_id, checkout_session_id, order_id, event_type, payload_hash
  ) VALUES (
    p_provider, BTRIM(p_provider_event_id), v_session.id, v_session.order_id, v_event_type, p_payload_sha256
  ) ON CONFLICT (provider, provider_event_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    SELECT * INTO v_event
      FROM public.payment_events
     WHERE provider = p_provider AND provider_event_id = p_provider_event_id;
    IF v_event.payload_hash IS DISTINCT FROM p_payload_sha256
       OR v_event.checkout_session_id IS DISTINCT FROM v_session.id
       OR v_event.order_id IS DISTINCT FROM v_session.order_id
       OR v_event.event_type IS DISTINCT FROM v_event_type THEN
      RAISE EXCEPTION 'provider_event_conflict';
    END IF;
    RETURN jsonb_build_object(
      'checkout_session_id', v_session.id,
      'order_id', v_session.order_id,
      'user_id', v_session.user_id,
      'status', v_session.status,
      'idempotent', TRUE
    );
  END IF;

  IF v_session.status = v_target_status THEN
    RETURN jsonb_build_object(
      'checkout_session_id', v_session.id,
      'order_id', v_session.order_id,
      'user_id', v_session.user_id,
      'status', v_session.status,
      'idempotent', TRUE
    );
  END IF;

  v_result := public.finalize_checkout(
    v_session.id,
    LOWER(p_outcome),
    BTRIM(p_provider_payment_id),
    NULL
  );

  IF LOWER(p_outcome) = 'cancelled' THEN
    UPDATE public.checkout_sessions SET status = 'cancelled', updated_at = NOW()
     WHERE id = v_session.id AND status = 'failed';
    UPDATE public.payments SET status = 'cancelled', failure_reason = 'cancelled', updated_at = NOW()
     WHERE id = v_payment.id AND status = 'failed';
  END IF;

  RETURN jsonb_build_object(
    'checkout_session_id', v_session.id,
    'order_id', v_session.order_id,
    'user_id', v_session.user_id,
    'status', v_target_status,
    'idempotent', FALSE,
    'result', v_result
  );
END;
$function$
;
