-- Phase 6 of Docs/plans/2026-09-30-1829-event-vendor-reservations.md.
-- Cancelling reservations when an event, a location or a vendor's stall is
-- cancelled, and releasing event stock whenever an order is refunded.
--
-- Refund rule (confirmed 2026-10-01): while the whole event has not started
-- (promotion_campaigns.starts_at), paid reservations are refunded
-- automatically for card, wallet and simulator payments; afterwards, or for
-- other payment methods, the refund is queued for an admin in /admin/refunds.
-- Pausing an event keeps its reservations.

-- ── Schema ────────────────────────────────────────────────────────────────

ALTER TABLE public.promotion_campaign_locations
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'promotion_campaign_locations_status_check') THEN
    ALTER TABLE public.promotion_campaign_locations ADD CONSTRAINT promotion_campaign_locations_status_check
      CHECK (status IN ('active', 'cancelled'));
  END IF;
END $$;

ALTER TABLE public.promotion_campaign_vendors DROP CONSTRAINT IF EXISTS promotion_campaign_vendors_status_check;
ALTER TABLE public.promotion_campaign_vendors ADD CONSTRAINT promotion_campaign_vendors_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'changes_requested', 'withdrawn', 'removed'));
ALTER TABLE public.promotion_campaign_vendors
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_reason TEXT;

-- Refunds the system may process without an admin (lib/refunds/process-refund.ts).
-- They stay 'pending' until processed; 'approved' already means an in-flight
-- simulator refund.
ALTER TABLE public.refunds ADD COLUMN IF NOT EXISTS auto_process BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS refunds_auto_process_idx ON public.refunds (created_at) WHERE auto_process AND status = 'pending';

-- ── Refunded or cancelled orders give their event places back ─────────────

CREATE OR REPLACE FUNCTION public.release_event_reservations_on_order_close()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF lower(NEW.status) IN ('refunded', 'cancelled') AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.checkout_reservations
       SET status = 'released'
     WHERE kind = 'event' AND status IN ('held', 'committed')
       AND checkout_session_id IN (SELECT id FROM public.checkout_sessions WHERE order_id = NEW.id);
    UPDATE public.order_items
       SET fulfil_status = 'cancelled'
     WHERE order_id = NEW.id AND event_location_id IS NOT NULL AND fulfil_status IN ('pending', 'ready');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_release_event_reservations ON public.orders;
CREATE TRIGGER orders_release_event_reservations
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.release_event_reservations_on_order_close();

-- ── Cancel the paid, uncollected reservations in a scope ──────────────────
-- Exactly one of p_campaign_id / p_location_id / p_registration_id is set.
-- Past pickups that were never collected are left alone (no-shows).

CREATE OR REPLACE FUNCTION public.cancel_event_reservations(
  p_campaign_id UUID,
  p_location_id UUID,
  p_registration_id UUID,
  p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_today DATE := (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::DATE;
  v_order_ids UUID[];
  v_order public.orders%ROWTYPE;
  v_payment public.payments%ROWTYPE;
  v_event_starts_at TIMESTAMPTZ;
  v_auto BOOLEAN;
  v_free INTEGER := 0;
  v_auto_count INTEGER := 0;
  v_manual_count INTEGER := 0;
  v_order_id UUID;
BEGIN
  SELECT array_agg(DISTINCT oi.order_id) INTO v_order_ids
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    JOIN public.promotion_campaign_locations l ON l.id = oi.event_location_id
    LEFT JOIN public.promotion_campaign_vendors reg
      ON reg.event_location_id = oi.event_location_id AND reg.vendor_id = oi.vendor_id
   WHERE oi.event_location_id IS NOT NULL
     AND oi.fulfil_status IN ('pending', 'ready')
     AND oi.pickup_date >= v_today
     AND lower(o.status) IN ('paid', 'completed')
     AND (p_campaign_id IS NULL OR l.campaign_id = p_campaign_id)
     AND (p_location_id IS NULL OR oi.event_location_id = p_location_id)
     AND (p_registration_id IS NULL OR reg.id = p_registration_id);

  FOREACH v_order_id IN ARRAY COALESCE(v_order_ids, ARRAY[]::UUID[]) LOOP
    SELECT * INTO v_order FROM public.orders WHERE id = v_order_id FOR UPDATE;
    IF lower(v_order.status) NOT IN ('paid', 'completed') THEN CONTINUE; END IF;

    -- The customer can no longer collect: cancel the lines and free the places now.
    UPDATE public.order_items
       SET fulfil_status = 'cancelled'
     WHERE order_id = v_order.id AND event_location_id IS NOT NULL AND fulfil_status IN ('pending', 'ready');
    UPDATE public.checkout_reservations
       SET status = 'released'
     WHERE kind = 'event' AND status IN ('held', 'committed')
       AND checkout_session_id IN (SELECT id FROM public.checkout_sessions WHERE order_id = v_order.id);

    IF v_order.total_amount = 0 THEN
      UPDATE public.orders SET status = 'cancelled', cancelled_at = now(), updated_at = now() WHERE id = v_order.id;
      v_free := v_free + 1;
    ELSE
      SELECT * INTO v_payment FROM public.payments
       WHERE order_id = v_order.id AND status = 'succeeded'
       ORDER BY created_at DESC LIMIT 1;
      IF FOUND AND NOT EXISTS (
        SELECT 1 FROM public.refunds r WHERE r.payment_id = v_payment.id AND r.status IN ('pending', 'approved', 'processed')
      ) THEN
        SELECT c.starts_at INTO v_event_starts_at
          FROM public.order_items oi
          JOIN public.promotion_campaign_locations l ON l.id = oi.event_location_id
          JOIN public.promotion_campaigns c ON c.id = l.campaign_id
         WHERE oi.order_id = v_order.id AND oi.event_location_id IS NOT NULL
         LIMIT 1;
        -- Automatic only before the whole event starts, and only where a safe
        -- automatic refund exists (card, wallet, simulators).
        v_auto := now() < v_event_starts_at AND (
          v_payment.method = 'wallet'
          OR (v_payment.provider = 'stripe' AND v_payment.method = 'stripe_card')
          OR v_payment.provider IN ('tng_ewallet_simulator', 'grabpay_simulator', 'bank_transfer_simulator')
        );
        INSERT INTO public.refunds (payment_id, order_id, amount, reason, status, auto_process)
        VALUES (v_payment.id, v_order.id, v_order.total_amount,
                'Event cancelled: ' || COALESCE(NULLIF(btrim(p_reason), ''), 'cancelled by organiser'), 'pending', v_auto);
        IF v_auto THEN v_auto_count := v_auto_count + 1; ELSE v_manual_count := v_manual_count + 1; END IF;
      END IF;
    END IF;

    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (v_order.user_id, 'event_reservation_cancelled', 'Your event reservation was cancelled',
            CASE WHEN v_order.total_amount = 0 THEN 'The organiser cancelled this reservation.'
                 ELSE 'The organiser cancelled this reservation. Your refund is being processed.' END,
            '/customer/orders/' || v_order.id);
  END LOOP;

  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, after_data, note)
  VALUES (auth.uid(), 'event_reservations.cancelled',
          CASE WHEN p_campaign_id IS NOT NULL THEN 'promotion_campaign'
               WHEN p_location_id IS NOT NULL THEN 'promotion_campaign_location'
               ELSE 'promotion_campaign_vendor' END,
          COALESCE(p_campaign_id, p_location_id, p_registration_id),
          jsonb_build_object('free', v_free, 'auto_refunds', v_auto_count, 'manual_refunds', v_manual_count),
          NULLIF(btrim(p_reason), ''));

  RETURN jsonb_build_object('free', v_free, 'autoRefunds', v_auto_count, 'manualRefunds', v_manual_count);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_event_reservations(UUID, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- ── Cascades: archived event, cancelled location → its stalls, closed stall ──

CREATE OR REPLACE FUNCTION public.on_promotion_campaign_archived()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.status = 'archived' AND OLD.status IS DISTINCT FROM 'archived' THEN
    PERFORM public.cancel_event_reservations(NEW.id, NULL, NULL, 'event cancelled');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS promotion_campaigns_cancel_reservations ON public.promotion_campaigns;
CREATE TRIGGER promotion_campaigns_cancel_reservations
  AFTER UPDATE OF status ON public.promotion_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.on_promotion_campaign_archived();

CREATE OR REPLACE FUNCTION public.on_promotion_campaign_location_cancelled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    UPDATE public.promotion_campaign_vendors
       SET status = 'removed', closed_at = now(),
           closed_reason = COALESCE(NEW.cancellation_reason, 'location cancelled'), updated_at = now()
     WHERE event_location_id = NEW.id AND status IN ('pending', 'approved', 'changes_requested');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS promotion_campaign_locations_cancel_stalls ON public.promotion_campaign_locations;
CREATE TRIGGER promotion_campaign_locations_cancel_stalls
  AFTER UPDATE OF status ON public.promotion_campaign_locations
  FOR EACH ROW EXECUTE FUNCTION public.on_promotion_campaign_location_cancelled();

CREATE OR REPLACE FUNCTION public.on_campaign_registration_closed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF NEW.status IN ('withdrawn', 'removed') AND OLD.status = 'approved' THEN
    PERFORM public.cancel_event_reservations(NULL, NULL, NEW.id, NEW.closed_reason);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS promotion_campaign_vendors_cancel_reservations ON public.promotion_campaign_vendors;
CREATE TRIGGER promotion_campaign_vendors_cancel_reservations
  AFTER UPDATE OF status ON public.promotion_campaign_vendors
  FOR EACH ROW EXECUTE FUNCTION public.on_campaign_registration_closed();

-- No new stalls at a cancelled location.
CREATE OR REPLACE FUNCTION public.reject_registration_at_cancelled_location()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.promotion_campaign_locations l WHERE l.id = NEW.event_location_id AND l.status = 'cancelled') THEN
    RAISE EXCEPTION 'promotion_campaign_location_cancelled';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS promotion_campaign_vendors_location_active ON public.promotion_campaign_vendors;
CREATE TRIGGER promotion_campaign_vendors_location_active
  BEFORE INSERT ON public.promotion_campaign_vendors
  FOR EACH ROW EXECUTE FUNCTION public.reject_registration_at_cancelled_location();

-- ── Actions ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.cancel_promotion_campaign_location(p_location_id UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_location public.promotion_campaign_locations%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_staff_permission(auth.uid(), 'admin.promotion_campaign.manage') THEN
    RAISE EXCEPTION 'permission_required';
  END IF;
  IF char_length(btrim(COALESCE(p_reason, ''))) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'cancellation_reason_required'; END IF;
  SELECT * INTO v_location FROM public.promotion_campaign_locations WHERE id = p_location_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_location.status = 'cancelled' THEN RAISE EXCEPTION 'already_cancelled'; END IF;
  UPDATE public.promotion_campaign_locations
     SET status = 'cancelled', cancelled_at = now(), cancellation_reason = btrim(p_reason)
   WHERE id = p_location_id
   RETURNING * INTO v_location;
  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, note)
  VALUES (auth.uid(), 'promotion_campaign_location.cancelled', 'promotion_campaign_location', p_location_id, btrim(p_reason));
  RETURN to_jsonb(v_location);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_promotion_campaign_location(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_promotion_campaign_location(UUID, TEXT) TO authenticated;

-- p_action: 'withdraw' (the vendor leaves) or 'remove' (admin takes them off).
CREATE OR REPLACE FUNCTION public.close_campaign_registration(p_registration_id UUID, p_action TEXT, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_reg public.promotion_campaign_vendors%ROWTYPE;
BEGIN
  IF p_action NOT IN ('withdraw', 'remove') THEN RAISE EXCEPTION 'invalid_action'; END IF;
  IF char_length(btrim(COALESCE(p_reason, ''))) NOT BETWEEN 5 AND 500 THEN RAISE EXCEPTION 'cancellation_reason_required'; END IF;
  SELECT * INTO v_reg FROM public.promotion_campaign_vendors WHERE id = p_registration_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF p_action = 'withdraw' AND NOT public.can_manage_vendor_events(v_reg.vendor_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_action = 'remove' AND (auth.uid() IS NULL OR NOT public.has_staff_permission(auth.uid(), 'admin.promotion_campaign.manage')) THEN
    RAISE EXCEPTION 'permission_required';
  END IF;
  IF v_reg.status NOT IN ('pending', 'approved', 'changes_requested') THEN RAISE EXCEPTION 'not_editable'; END IF;

  UPDATE public.promotion_campaign_vendors
     SET status = CASE WHEN p_action = 'withdraw' THEN 'withdrawn' ELSE 'removed' END,
         closed_at = now(), closed_reason = btrim(p_reason), updated_at = now()
   WHERE id = p_registration_id
   RETURNING * INTO v_reg;
  INSERT INTO public.audit_logs (actor_id, action, entity_type, entity_id, note)
  VALUES (auth.uid(), 'promotion_campaign_vendor.' || CASE WHEN p_action = 'withdraw' THEN 'withdrawn' ELSE 'removed' END,
          'promotion_campaign_vendor', p_registration_id, btrim(p_reason));
  RETURN jsonb_build_object('id', v_reg.id, 'status', v_reg.status);
END;
$$;

REVOKE ALL ON FUNCTION public.close_campaign_registration(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_campaign_registration(UUID, TEXT, TEXT) TO authenticated;

-- ── Service role may process queued (auto_process) wallet refunds ─────────
-- Same signature; only the caller check changes.

CREATE OR REPLACE FUNCTION public.process_wallet_refund(p_refund_id uuid, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_refund refunds%ROWTYPE;
  v_payment payments%ROWTYPE;
  v_order orders%ROWTYPE;
  v_wallet wallets%ROWTYPE;
  v_topup_sen BIGINT := 0;
  v_earnings_sen BIGINT := 0;
  v_total_sen BIGINT;
BEGIN
  -- Super admins approve refunds by hand; the service role processes refunds
  -- queued automatically for cancelled events (refunds.auto_process).
  IF NOT (
    COALESCE(auth.jwt() ->> 'role', '') = 'service_role'
    OR (v_actor IS NOT NULL AND public.is_super_admin(v_actor))
  ) THEN
    RAISE EXCEPTION 'super_admin_required';
  END IF;

  SELECT * INTO v_refund FROM public.refunds WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'refund_not_found'; END IF;
  IF v_refund.status = 'processed' THEN
    RETURN jsonb_build_object('refund_id', v_refund.id, 'status', 'processed');
  END IF;
  IF v_refund.status <> 'pending' THEN RAISE EXCEPTION 'refund_not_pending'; END IF;

  SELECT * INTO v_payment FROM public.payments WHERE id = v_refund.payment_id FOR UPDATE;
  SELECT * INTO v_order FROM public.orders WHERE id = v_refund.order_id FOR UPDATE;
  IF v_payment.method <> 'wallet' OR v_payment.status <> 'succeeded' THEN
    RAISE EXCEPTION 'wallet_refund_requires_successful_wallet_payment';
  END IF;
  IF ROUND(v_refund.amount * 100)::BIGINT <> ROUND(v_order.total_amount * 100)::BIGINT THEN
    RAISE EXCEPTION 'wallet_refund_must_be_full';
  END IF;
  v_total_sen := ROUND(v_refund.amount * 100)::BIGINT;

  SELECT
    COALESCE(SUM(amount_sen) FILTER (WHERE bucket = 'topup'), 0),
    COALESCE(SUM(amount_sen) FILTER (WHERE bucket = 'earnings'), 0)
  INTO v_topup_sen, v_earnings_sen
  FROM public.wallet_transactions
  WHERE order_id = v_refund.order_id AND type = 'spend' AND direction = 'debit';
  IF v_topup_sen + v_earnings_sen <> v_total_sen THEN
    RAISE EXCEPTION 'wallet_payment_ledger_missing';
  END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE user_id = v_order.user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'wallet_not_found'; END IF;
  UPDATE public.wallets
     SET topup_sen = topup_sen + v_topup_sen,
         earnings_sen = earnings_sen + v_earnings_sen,
         updated_at = NOW()
   WHERE id = v_wallet.id;
  IF v_topup_sen > 0 THEN
    INSERT INTO public.wallet_transactions
      (user_id, wallet_id, order_id, idempotency_key, type, amount_sen, bucket, direction, note)
    VALUES
      (v_order.user_id, v_wallet.id, v_order.id,
       'wallet-refund:' || v_refund.id::text || ':topup',
       'refund', v_topup_sen, 'topup', 'credit', COALESCE(p_note, 'Full Wallet order refund'));
  END IF;
  IF v_earnings_sen > 0 THEN
    INSERT INTO public.wallet_transactions
      (user_id, wallet_id, order_id, idempotency_key, type, amount_sen, bucket, direction, note)
    VALUES
      (v_order.user_id, v_wallet.id, v_order.id,
       'wallet-refund:' || v_refund.id::text || ':earnings',
       'refund', v_earnings_sen, 'earnings', 'credit', COALESCE(p_note, 'Full Wallet order refund'));
  END IF;
  UPDATE public.refunds
     SET status = 'processed', processed_by = v_actor, processed_at = NOW(),
         reason = COALESCE(p_note, reason)
   WHERE id = v_refund.id;
  UPDATE public.payments SET status = 'refunded', updated_at = NOW() WHERE id = v_payment.id;
  UPDATE public.orders SET status = 'refunded', updated_at = NOW() WHERE id = v_order.id;
  INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, before_data, after_data, note)
  VALUES (
    v_actor, 'wallet.refunded', 'refund', v_refund.id,
    jsonb_build_object('status', 'pending', 'amount_sen', v_total_sen),
    jsonb_build_object('status', 'processed', 'topup_sen', v_topup_sen, 'earnings_sen', v_earnings_sen),
    p_note
  );
  INSERT INTO public.notifications(user_id, type, title, body, link)
  VALUES (
    v_order.user_id,
    'wallet_refund',
    'Wallet refund processed',
    'Your full refund has been returned to the Wallet balance buckets used for the original payment.',
    '/customer/wallet'
  );
  RETURN jsonb_build_object('refund_id', v_refund.id, 'status', 'processed');
END;
$function$;

-- ── Public projection: cancelled locations are not shown ──────────────────
-- Same (TEXT) signature as 20260930220000 — true CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.get_public_promotion_campaigns(p_slug text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_campaign RECORD;
  v_vendor RECORD;
  v_reg RECORD;
  v_product RECORD;
  v_products JSONB;
  v_stalls JSONB;
  v_vendors JSONB;
  v_locations JSONB;
  v_result JSONB := '[]'::JSONB;
  v_visibility TEXT;
BEGIN
  FOR v_campaign IN
    SELECT campaign.*
      FROM public.promotion_campaigns AS campaign
     WHERE campaign.status = 'approved'
       AND campaign.ends_at > now()
       AND (p_slug IS NULL OR campaign.slug = p_slug)
     ORDER BY campaign.starts_at ASC, campaign.created_at DESC
  LOOP
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'id', l.id,
             'name', l.name,
             'address', l.address,
             'lat', l.lat,
             'lng', l.lng,
             'startsOn', l.starts_on,
             'endsOn', l.ends_on,
             'opensAt', to_char(l.opens_at, 'HH24:MI'),
             'closesAt', to_char(l.closes_at, 'HH24:MI')
           ) ORDER BY l.starts_on, l.name), '[]'::JSONB)
      INTO v_locations
      FROM public.promotion_campaign_locations l
     WHERE l.campaign_id = v_campaign.id
       AND l.status = 'active';

    v_vendors := '[]'::JSONB;

    FOR v_vendor IN
      SELECT DISTINCT vendor.id, vendor.name, vendor.logo_url, vendor.kind
        FROM public.promotion_campaign_vendors AS reg
        JOIN public.vendors AS vendor ON vendor.id = reg.vendor_id
       WHERE reg.campaign_id = v_campaign.id
         AND reg.status = 'approved'
         AND vendor.status = 'approved'
       ORDER BY vendor.name
    LOOP
      v_stalls := '[]'::JSONB;

      FOR v_reg IN
        SELECT reg.*
          FROM public.promotion_campaign_vendors AS reg
          JOIN public.promotion_campaign_locations AS l ON l.id = reg.event_location_id
         WHERE reg.campaign_id = v_campaign.id
           AND reg.vendor_id = v_vendor.id
           AND reg.status = 'approved'
         ORDER BY l.starts_on, l.name
      LOOP
        v_products := '[]'::JSONB;

        FOR v_product IN
          SELECT
            vp.id,
            vp.position,
            vp.item_kind,
            vp.price,
            COALESCE(product.name, vp.name) AS name,
            COALESCE(product.cover_url, product_media.url, vp.image_url) AS image_url
            FROM public.promotion_campaign_vendor_products AS vp
            LEFT JOIN public.products AS product ON product.id = vp.product_id
            LEFT JOIN LATERAL (
              SELECT media.url
                FROM public.media_assets AS media
               WHERE media.product_id = product.id AND media.media_type = 'image'
               ORDER BY media.sort_order NULLS LAST, media.created_at
               LIMIT 1
            ) AS product_media ON product.id IS NOT NULL
           WHERE vp.registration_id = v_reg.id
             AND vp.active
           ORDER BY vp.position
        LOOP
          v_products := v_products || jsonb_build_array(jsonb_build_object(
            'id', v_product.id,
            'name', v_product.name,
            'kind', v_product.item_kind,
            'price', v_product.price,
            'imageUrl', v_product.image_url
          ));
        END LOOP;

        v_stalls := v_stalls || jsonb_build_array(jsonb_build_object(
          'registrationId', v_reg.id,
          'locationId', v_reg.event_location_id,
          'stallNumber', v_reg.stall_number,
          'stallDescription', v_reg.stall_description,
          'stallPosterUrl', v_reg.stall_poster_url,
          'products', v_products
        ));
      END LOOP;

      v_vendors := v_vendors || jsonb_build_array(jsonb_build_object(
        'vendorId', v_vendor.id,
        'vendorName', v_vendor.name,
        'vendorLogoUrl', v_vendor.logo_url,
        'vendorKind', v_vendor.kind,
        'stalls', v_stalls
      ));
    END LOOP;

    v_visibility := CASE WHEN v_campaign.starts_at <= now() THEN 'live' ELSE 'upcoming' END;
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'id', v_campaign.id,
      'slug', v_campaign.slug,
      'title', v_campaign.title,
      'summary', v_campaign.summary,
      'description', v_campaign.description,
      'posterUrl', v_campaign.poster_url,
      'operatingHours', v_campaign.operating_hours,
      'startsAt', v_campaign.starts_at,
      'endsAt', v_campaign.ends_at,
      'visibility', v_visibility,
      'locations', v_locations,
      'vendors', v_vendors
    ));
  END LOOP;

  RETURN v_result;
END;
$function$;

NOTIFY pgrst, 'reload schema';
