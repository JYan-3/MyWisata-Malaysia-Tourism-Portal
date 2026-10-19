-- Installed ordinary shared core, read-only snapshot 2026-10-16.
-- Used exclusively in the disposable loopback fixture; no production data.
CREATE OR REPLACE FUNCTION public.checkout_transaction_core(p_cart_id uuid, p_selected_item_ids uuid[], p_idempotency_key text, p_request_hash text, p_payment_method text, p_subtotal numeric, p_discount numeric, p_total numeric, p_voucher_code text, p_lines jsonb, p_owner_user uuid, p_owner_guest uuid, p_contact jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user UUID := p_owner_user;
  v_session checkout_sessions%ROWTYPE;
  v_order_id UUID;
  v_payment_id UUID;
  v_cart_user UUID;
  v_cart_item public.cart_items%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_variant public.product_variants%ROWTYPE;
  v_slot public.booking_slots%ROWTYPE;
  v_price_rule public.price_rules%ROWTYPE;
  v_authoritative_price NUMERIC;
  v_line_count INTEGER := 0;
  v_distinct_line_count INTEGER := 0;
  v_selected_count INTEGER := 0;
  v_line RECORD;
  v_order_item_id UUID;
  v_booking_id UUID;
  v_updated INTEGER;
  v_product_booking BOOLEAN;
  v_voucher vouchers%ROWTYPE;
  v_existing_redemptions INTEGER;
  v_existing_holds INTEGER;
  v_line_sum NUMERIC := 0;
  v_expected_discount NUMERIC := 0;
  v_eligible_subtotal NUMERIC := 0;
  v_is_free BOOLEAN := false;
  v_order_status TEXT := 'pending_payment';
  v_payment_status TEXT := 'pending';
  v_session_status TEXT := 'pending_payment';
  v_res_status TEXT := 'held';
BEGIN
  PERFORM public.validate_checkout_subject(v_user,p_owner_guest,p_contact);
     IF p_owner_guest IS NOT NULL AND p_payment_method IN ('wallet','wallet_split') THEN RAISE EXCEPTION 'guest_account_feature_denied'; END IF;
     PERFORM pg_advisory_xact_lock(hashtextextended(coalesce(v_user,p_owner_guest)::text||p_idempotency_key,0));
  IF NOT EXISTS(SELECT 1 FROM public.carts WHERE id=p_cart_id AND user_id IS NOT DISTINCT FROM v_user AND guest_subject_id IS NOT DISTINCT FROM p_owner_guest) THEN RAISE EXCEPTION 'cart_not_owned'; END IF;
   IF p_owner_guest IS NOT NULL AND nullif(trim(p_voucher_code),'') IS NOT NULL THEN RAISE EXCEPTION 'guest_account_feature_denied'; END IF;

  SELECT * INTO v_session
    FROM public.checkout_sessions
   WHERE user_id IS NOT DISTINCT FROM v_user AND guest_subject_id IS NOT DISTINCT FROM p_owner_guest AND idempotency_key = p_idempotency_key
   FOR UPDATE;
  IF FOUND THEN
    IF v_session.request_hash <> p_request_hash THEN RAISE EXCEPTION 'idempotency_key_reused'; END IF;
    RETURN jsonb_build_object('checkout_session_id', v_session.id, 'order_id', v_session.order_id, 'status', v_session.status);
  END IF;

  IF p_payment_method NOT IN ('mock_card','stripe_card','ewallet','bank_transfer','wallet','free_reservation') THEN
    RAISE EXCEPTION 'invalid_payment_method';
  END IF;

  IF p_total < 0 OR p_discount < 0 OR p_subtotal < 0 OR p_total <> ROUND(p_subtotal - p_discount, 2) THEN
    RAISE EXCEPTION 'invalid_checkout_totals';
  END IF;

  IF p_payment_method = 'free_reservation' THEN
    IF p_total <> 0 THEN
      RAISE EXCEPTION 'free_reservation_requires_zero_total';
    END IF;
    v_is_free := true;
    v_order_status := 'paid';
    v_payment_status := 'succeeded';
    v_session_status := 'paid';
    v_res_status := 'committed';
  END IF;

  IF v_is_free AND (p_selected_item_ids IS NULL OR cardinality(p_selected_item_ids) = 0) THEN
    RAISE EXCEPTION 'checkout_lines_required';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_to_recordset(p_lines) AS x(
    cart_item_id UUID, product_id UUID, variant_id UUID, slot_id UUID, vendor_id UUID, outlet_id UUID,
    product_name TEXT, image_url TEXT, variant_name TEXT, slot_starts_at TIMESTAMPTZ,
    unit_price NUMERIC, quantity INTEGER, line_total NUMERIC, requires_booking BOOLEAN
  ) LOOP
    v_line_count := v_line_count + 1;
    IF p_selected_item_ids IS NOT NULL AND NOT (v_line.cart_item_id = ANY(p_selected_item_ids)) THEN
      RAISE EXCEPTION 'checkout_line_not_selected';
    END IF;
    IF v_line.quantity IS NULL OR v_line.quantity < 1 OR v_line.line_total <> ROUND(v_line.unit_price * v_line.quantity, 2) THEN
      RAISE EXCEPTION 'invalid_line_quantity';
    END IF;

    SELECT * INTO v_cart_item
      FROM public.cart_items
     WHERE id = v_line.cart_item_id AND cart_id = p_cart_id
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'cart_line_not_found'; END IF;
    IF v_cart_item.variant_id IS DISTINCT FROM v_line.variant_id
       OR v_cart_item.slot_id IS DISTINCT FROM v_line.slot_id
       OR v_cart_item.outlet_id IS DISTINCT FROM v_line.outlet_id
       OR v_cart_item.quantity IS DISTINCT FROM v_line.quantity THEN
      RAISE EXCEPTION 'checkout_line_mismatch';
    END IF;


                                        SELECT * INTO v_product
                                              FROM public.products
                                                   WHERE id = v_line.product_id
                                                          AND vendor_id = v_line.vendor_id
                                                                 AND status = 'active'
                                                                        AND review_status = 'approved';
                                                                            IF NOT FOUND
                                                                                   OR (
                                                                                            v_product.outlet_id IS DISTINCT FROM v_line.outlet_id
                                                                                                     AND NOT EXISTS (
                                                                                                                SELECT 1
                                                                                                                             FROM public.outlet_offers offer
                                                                                                                                         WHERE offer.product_id = v_product.id
                                                                                                                                                       AND offer.outlet_id = v_line.outlet_id
                                                                                                                                                                     AND offer.status = 'active'
                                                                                                                                                                              )
                                                                                                                                                                                     )
                                                                                                                                                                                            OR v_product.requires_booking <> COALESCE(v_line.requires_booking, false) THEN
                                                                                                                                                                                                  RAISE EXCEPTION 'product_not_purchasable';
                                                                                                                                                                                                      END IF;

    v_product_booking := v_product.requires_booking;
     IF v_line.product_name IS DISTINCT FROM v_product.name OR v_line.image_url IS DISTINCT FROM v_product.cover_url THEN RAISE EXCEPTION 'checkout_product_snapshot_mismatch'; END IF;
     IF v_line.outlet_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.outlets WHERE id=v_line.outlet_id AND vendor_id=v_line.vendor_id AND status='active') THEN RAISE EXCEPTION 'product_not_purchasable_at_outlet'; END IF;


    v_variant := NULL;
    IF v_line.variant_id IS NOT NULL THEN
      SELECT * INTO v_variant
        FROM public.product_variants
       WHERE id = v_line.variant_id
         AND product_id = v_line.product_id
         AND is_active;
      IF NOT FOUND THEN RAISE EXCEPTION 'variant_not_purchasable'; END IF;
     IF v_variant.name IS DISTINCT FROM v_line.variant_name THEN RAISE EXCEPTION 'checkout_variant_snapshot_mismatch'; END IF;
    ELSIF NOT v_product_booking THEN
      RAISE EXCEPTION 'variant_not_purchasable';
    END IF;


    v_slot := NULL;
    IF v_product_booking THEN
      SELECT * INTO v_slot
        FROM public.booking_slots
       WHERE id = v_line.slot_id
         AND product_id = v_line.product_id
         AND outlet_id = v_line.outlet_id
       FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'booking_slot_invalid'; END IF;
     IF v_line.slot_starts_at IS DISTINCT FROM v_slot.starts_at THEN RAISE EXCEPTION 'checkout_slot_snapshot_mismatch'; END IF;
    END IF;

    v_authoritative_price := v_product.base_price + COALESCE(v_variant.price_offset, 0);
     IF v_product.outlet_id IS NULL AND v_line.outlet_id IS NOT NULL THEN
       SELECT price+COALESCE(v_variant.price_offset,0) INTO v_authoritative_price FROM public.outlet_offers
         WHERE product_id=v_product.id AND outlet_id=v_line.outlet_id AND status='active' FOR SHARE;
       IF NOT FOUND THEN RAISE EXCEPTION 'product_not_purchasable_at_outlet'; END IF;
     END IF;
      IF v_product_booking AND v_slot.price_override IS NOT NULL THEN
        v_authoritative_price := v_slot.price_override;
      ELSE
        SELECT * INTO v_price_rule
          FROM public.price_rules pr
         WHERE pr.product_id = v_product.id
           AND pr.is_active
           AND (pr.valid_from IS NULL OR pr.valid_from <= CURRENT_DATE)
           AND (pr.valid_until IS NULL OR pr.valid_until >= CURRENT_DATE)
           AND NOT (
             pr.rule_type = 'weekend'
             AND EXTRACT(DOW FROM NOW()) NOT IN (0, 6)
           )
           AND NOT (
             pr.rule_type IN ('group_size', 'tiered')
             AND v_line.quantity < COALESCE(pr.min_quantity, 1)
           )
           AND NOT (
             pr.rule_type = 'bundle'
             AND EXISTS (
               SELECT 1
                 FROM unnest(COALESCE(pr.bundle_product_ids, ARRAY[]::UUID[])) AS required(product_id)
                WHERE NOT EXISTS (
                  SELECT 1
                    FROM jsonb_to_recordset(p_lines) AS cart_line(product_id UUID)
                   WHERE cart_line.product_id = required.product_id
                )
             )
           )
         ORDER BY pr.priority DESC
         LIMIT 1;

        IF FOUND THEN
          IF v_price_rule.fixed_amount IS NOT NULL THEN
            v_authoritative_price := GREATEST(0, v_price_rule.fixed_amount);
          ELSIF v_price_rule.multiplier IS NOT NULL THEN
            v_authoritative_price := v_authoritative_price * v_price_rule.multiplier;
          END IF;
        END IF;
      END IF;

      IF v_is_free AND ROUND(v_authoritative_price, 2) <> 0 THEN
        RAISE EXCEPTION 'free_reservation_product_not_free';
      END IF;
      IF v_line.unit_price IS NULL OR v_line.line_total IS NULL OR v_line.unit_price<0 OR ROUND(v_line.unit_price, 2) <> ROUND(v_authoritative_price, 2)
         OR ROUND(v_line.line_total, 2) <> ROUND(v_authoritative_price * v_line.quantity, 2) THEN
        RAISE EXCEPTION 'checkout_line_price_mismatch';
      END IF;

    v_line_sum := v_line_sum + v_line.line_total;
  END LOOP;

  IF v_line_count = 0 THEN RAISE EXCEPTION 'checkout_lines_required'; END IF;
  SELECT COUNT(DISTINCT x.cart_item_id)
      INTO v_distinct_line_count
      FROM jsonb_to_recordset(p_lines) AS x(cart_item_id UUID);
    SELECT COUNT(DISTINCT selected_id)
      INTO v_selected_count
      FROM unnest(p_selected_item_ids) AS selected(selected_id);
    IF v_distinct_line_count <> v_line_count
       OR v_selected_count <> v_line_count
       OR cardinality(p_selected_item_ids) <> v_line_count THEN
      RAISE EXCEPTION 'checkout_selection_mismatch';
    END IF;

  IF ROUND(v_line_sum, 2) <> ROUND(p_subtotal, 2) THEN RAISE EXCEPTION 'checkout_subtotal_mismatch'; END IF;

  IF p_voucher_code IS NOT NULL AND length(trim(p_voucher_code)) > 0 THEN
    SELECT * INTO v_voucher FROM public.vouchers WHERE upper(code) = upper(trim(p_voucher_code)) AND is_active AND review_status = 'approved' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'voucher_not_available'; END IF;
    IF v_voucher.valid_from IS NOT NULL AND v_voucher.valid_from > NOW() THEN RAISE EXCEPTION 'voucher_not_started'; END IF;
    IF v_voucher.valid_until IS NOT NULL AND v_voucher.valid_until < NOW() THEN RAISE EXCEPTION 'voucher_expired'; END IF;
    IF v_voucher.max_uses IS NOT NULL AND v_voucher.uses_count + v_voucher.reserved_uses >= v_voucher.max_uses THEN RAISE EXCEPTION 'voucher_limit_reached'; END IF;
    IF v_voucher.redemption_mode NOT IN ('online', 'both') THEN RAISE EXCEPTION 'voucher_not_available_online'; END IF;
    SELECT COALESCE(SUM(x.line_total), 0)
      INTO v_eligible_subtotal
      FROM jsonb_to_recordset(p_lines) AS x(product_id UUID, vendor_id UUID, outlet_id UUID, line_total NUMERIC)
     WHERE x.vendor_id = v_voucher.vendor_id
       AND (v_voucher.outlet_id IS NULL OR x.outlet_id = v_voucher.outlet_id)
       AND (v_voucher.product_id IS NULL OR x.product_id = v_voucher.product_id);
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_to_recordset(p_lines) AS x(product_id UUID, vendor_id UUID, outlet_id UUID)
       WHERE x.vendor_id = v_voucher.vendor_id
         AND (v_voucher.outlet_id IS NULL OR x.outlet_id = v_voucher.outlet_id)
         AND (v_voucher.product_id IS NULL OR x.product_id = v_voucher.product_id)
    ) THEN RAISE EXCEPTION 'voucher_not_applicable'; END IF;
    IF v_eligible_subtotal < COALESCE(v_voucher.min_spend, 0) THEN RAISE EXCEPTION 'voucher_minimum_spend'; END IF;
    SELECT count(*) INTO v_existing_redemptions FROM public.voucher_redemptions WHERE voucher_id = v_voucher.id AND user_id = v_user;
    SELECT count(*) INTO v_existing_holds FROM public.voucher_holds WHERE voucher_id = v_voucher.id AND user_id = v_user AND status = 'held';
    IF v_voucher.per_customer_limit IS NOT NULL AND v_existing_redemptions + v_existing_holds >= v_voucher.per_customer_limit THEN RAISE EXCEPTION 'voucher_customer_limit_reached'; END IF;

    IF v_voucher.voucher_type = 'bogo' THEN
      SELECT COALESCE(LEAST(v_eligible_subtotal, SUM(FLOOR(x.quantity::NUMERIC / NULLIF(v_voucher.buy_quantity, 0)) * v_voucher.free_quantity * x.unit_price)), 0)
        INTO v_expected_discount
        FROM jsonb_to_recordset(p_lines) AS x(product_id UUID, vendor_id UUID, outlet_id UUID, quantity INTEGER, unit_price NUMERIC, line_total NUMERIC)
       WHERE x.vendor_id = v_voucher.vendor_id
         AND (v_voucher.outlet_id IS NULL OR x.outlet_id = v_voucher.outlet_id)
         AND (v_voucher.product_id IS NULL OR x.product_id = v_voucher.product_id);
    ELSIF v_voucher.voucher_type = 'percent' THEN
      v_expected_discount := LEAST(v_eligible_subtotal, v_eligible_subtotal * v_voucher.discount_value / 100);
    ELSE
      v_expected_discount := LEAST(v_eligible_subtotal, v_voucher.discount_value);
    END IF;
    IF ROUND(COALESCE(p_discount, 0), 2) <> ROUND(COALESCE(v_expected_discount, 0), 2) THEN
      RAISE EXCEPTION 'voucher_discount_mismatch';
    END IF;
  ELSIF ROUND(COALESCE(p_discount, 0), 2) <> 0 THEN
    RAISE EXCEPTION 'invalid_checkout_totals';
  END IF;

  INSERT INTO public.orders(user_id, guest_subject_id, contact_email, contact_name, contact_phone, status, subtotal, discount_amount, total_amount, payment_method, voucher_code, paid_at)
  VALUES (v_user,p_owner_guest,p_contact->>'email',p_contact->>'name',p_contact->>'phone', v_order_status, p_subtotal, p_discount, p_total, p_payment_method, NULLIF(trim(p_voucher_code), ''), CASE WHEN v_is_free THEN NOW() ELSE NULL END)
  RETURNING id INTO v_order_id;

  INSERT INTO public.payments(order_id, method, provider, amount, status, idempotency_key, processed_at)
  VALUES (
    v_order_id,
    p_payment_method,
    CASE WHEN v_is_free THEN 'platform' WHEN p_payment_method = 'stripe_card' THEN 'stripe' ELSE 'platform' END,
    p_total,
    v_payment_status,
    p_idempotency_key,
    CASE WHEN v_is_free THEN NOW() ELSE NULL END
  )
  RETURNING id INTO v_payment_id;

  INSERT INTO public.checkout_sessions(user_id, guest_subject_id, cart_id, order_id, payment_method, idempotency_key, request_hash, subtotal, discount_amount, total_amount, status)
  VALUES (v_user,p_owner_guest, p_cart_id, v_order_id, p_payment_method, p_idempotency_key, p_request_hash, p_subtotal, p_discount, p_total, v_session_status)
  RETURNING * INTO v_session;

  FOR v_line IN SELECT * FROM jsonb_to_recordset(p_lines) AS x(
    cart_item_id UUID, product_id UUID, variant_id UUID, slot_id UUID, vendor_id UUID, outlet_id UUID,
    product_name TEXT, image_url TEXT, variant_name TEXT, slot_starts_at TIMESTAMPTZ,
    unit_price NUMERIC, quantity INTEGER, line_total NUMERIC, requires_booking BOOLEAN
  ) LOOP
    INSERT INTO public.order_items(order_id, vendor_id, outlet_id, product_id, variant_id, slot_id, product_name, image_url, variant_name, slot_starts_at, unit_price, quantity, line_total, fulfil_status)
    VALUES (v_order_id, v_line.vendor_id, v_line.outlet_id, v_line.product_id, v_line.variant_id, v_line.slot_id, v_line.product_name, v_line.image_url, v_line.variant_name, v_line.slot_starts_at, v_line.unit_price, v_line.quantity, v_line.line_total, 'pending')
    RETURNING id INTO v_order_item_id;

    IF COALESCE(v_line.requires_booking, false) THEN
      UPDATE public.booking_slots
         SET booked = booked + v_line.quantity,
             status = CASE WHEN booked + v_line.quantity >= capacity THEN 'full' ELSE status END
       WHERE id = v_line.slot_id AND status = 'available' AND booked + v_line.quantity <= capacity;
      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_updated <> 1 THEN RAISE EXCEPTION 'booking_capacity_unavailable'; END IF;

      INSERT INTO public.checkout_reservations(checkout_session_id, kind, slot_id, outlet_id, quantity, cart_item_id, status)
      VALUES (v_session.id, 'booking', v_line.slot_id, v_line.outlet_id, v_line.quantity, v_line.cart_item_id, v_res_status);

      INSERT INTO public.bookings(order_item_id, slot_id, customer_id, guest_subject_id, demo_qr_code, status)
      VALUES (v_order_item_id, v_line.slot_id, v_user,p_owner_guest, 'MY-' || upper(right(replace(v_order_id::text, '-', ''), 10)), 'confirmed')
      RETURNING id INTO v_booking_id;

      INSERT INTO public.ticket_passes(booking_id, order_item_id, customer_id, guest_subject_id, policy, entry_limit, entries_used, status)
      VALUES (
        v_booking_id, v_order_item_id, v_user,p_owner_guest,
        CASE WHEN v_line.quantity > 1 THEN 'group_entry' ELSE 'single_entry' END,
        v_line.quantity, 0, 'active'
      )
      ON CONFLICT (booking_id) DO NOTHING;
    ELSE
      UPDATE public.inventory
         SET reserved = reserved + v_line.quantity, updated_at = NOW()
       WHERE variant_id = v_line.variant_id AND outlet_id IS NOT DISTINCT FROM v_line.outlet_id AND quantity - reserved >= v_line.quantity;
      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_updated <> 1 THEN RAISE EXCEPTION 'inventory_unavailable'; END IF;

      INSERT INTO public.checkout_reservations(checkout_session_id, kind, variant_id, outlet_id, quantity, cart_item_id, status)
      VALUES (v_session.id, 'inventory', v_line.variant_id, v_line.outlet_id, v_line.quantity, v_line.cart_item_id, v_res_status);
    END IF;
  END LOOP;

  IF v_is_free THEN
    DELETE FROM public.cart_items WHERE cart_id = p_cart_id AND id = ANY(p_selected_item_ids);
  END IF;

  IF v_voucher.id IS NOT NULL THEN
    UPDATE public.vouchers SET reserved_uses = reserved_uses + 1 WHERE id = v_voucher.id;
    INSERT INTO public.voucher_holds(voucher_id, checkout_session_id, user_id) VALUES (v_voucher.id, v_session.id, v_user);
  END IF;

  RETURN jsonb_build_object(
    'checkout_session_id', v_session.id,
    'order_id', v_order_id,
    'payment_id', v_payment_id,
    'status', v_session_status,
    'expires_at', v_session.expires_at
  );
END;
$function$
;
