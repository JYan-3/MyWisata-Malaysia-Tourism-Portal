-- Vendor platform fee tiers (Docs/plans/2026-10-07-2307-vendor-platform-fee-tiers.md).
--
-- 1. Three shared tiers. Each charges either a % of the item price or a fixed
--    RM amount per item. Vendors are placed by rolling 90-day settled sales
--    (recomputed nightly by wallet-maintenance), unless admin pins a tier.
-- 2. Order lines bought from an event pay the event's fixed fee per item
--    (campaign value, else the global default), ignoring the vendor's tier.
-- 3. Affiliate and recommendation payouts are funded from the platform fee, so
--    the fee is floored at the payout the order owes (never above the sale).
--
-- Seeded so nothing changes on deploy: all three tiers charge the current
-- global percentage, and the event default is unset (event lines fall back
-- to the tier).

-- ── 1. Tiers ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.vendor_fee_tiers (
  rank               SMALLINT PRIMARY KEY CHECK (rank BETWEEN 1 AND 3),
  name               TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 40),
  fee_type           TEXT NOT NULL CHECK (fee_type IN ('percent', 'fixed')),
  percent_rate       NUMERIC(5,4),
  fixed_per_item_sen BIGINT,
  min_sales_sen      BIGINT NOT NULL DEFAULT 0 CHECK (min_sales_sen >= 0),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by         UUID,
  CONSTRAINT vendor_fee_tiers_fee_shape CHECK (
    (fee_type = 'percent' AND percent_rate >= 0 AND percent_rate < 1 AND fixed_per_item_sen IS NULL)
    OR (fee_type = 'fixed' AND fixed_per_item_sen BETWEEN 0 AND 100000 AND percent_rate IS NULL)
  ),
  CONSTRAINT vendor_fee_tiers_entry_tier_open CHECK (rank <> 1 OR min_sales_sen = 0)
);

-- Server-only: admin and vendor reads go through service-role API routes.
ALTER TABLE public.vendor_fee_tiers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vendor_fee_tiers FROM PUBLIC, anon, authenticated;

INSERT INTO public.vendor_fee_tiers (rank, name, fee_type, percent_rate, min_sales_sen)
SELECT t.rank, t.name, 'percent', g.rate, t.min_sales_sen
FROM (VALUES (1::SMALLINT, 'Bronze', 0::BIGINT), (2::SMALLINT, 'Silver', 1000000::BIGINT), (3::SMALLINT, 'Gold', 5000000::BIGINT))
  AS t(rank, name, min_sales_sen)
CROSS JOIN (
  SELECT COALESCE((
    SELECT NULLIF(value, '')::NUMERIC FROM public.platform_settings
    WHERE key = 'commission.platform_rate' AND NULLIF(value, '')::NUMERIC >= 0 AND NULLIF(value, '')::NUMERIC < 1
  ), 0.15) AS rate
) AS g
ON CONFLICT (rank) DO NOTHING;

-- ── 2. Vendor placement ──────────────────────────────────────────────────────

ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS fee_tier_rank SMALLINT NOT NULL DEFAULT 1 CHECK (fee_tier_rank BETWEEN 1 AND 3),
  ADD COLUMN IF NOT EXISTS fee_tier_pinned SMALLINT CHECK (fee_tier_pinned BETWEEN 1 AND 3),
  ADD COLUMN IF NOT EXISTS fee_tier_sales_sen BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_tier_evaluated_at TIMESTAMPTZ;

-- ── 3. Event fee per item ────────────────────────────────────────────────────

ALTER TABLE public.promotion_campaigns
  ADD COLUMN IF NOT EXISTS platform_fee_per_item_sen BIGINT
    CHECK (platform_fee_per_item_sen BETWEEN 0 AND 100000);

-- ── 4. Settlement snapshot ───────────────────────────────────────────────────

ALTER TABLE public.order_settlements
  ADD COLUMN IF NOT EXISTS fee_type TEXT NOT NULL DEFAULT 'percent' CHECK (fee_type IN ('percent', 'fixed', 'mixed')),
  ADD COLUMN IF NOT EXISTS fee_source TEXT NOT NULL DEFAULT 'tier' CHECK (fee_source IN ('tier', 'event', 'mixed')),
  ADD COLUMN IF NOT EXISTS fee_per_item_sen BIGINT,
  ADD COLUMN IF NOT EXISTS fee_tier_rank SMALLINT,
  ADD COLUMN IF NOT EXISTS item_count INT,
  ADD COLUMN IF NOT EXISTS base_fee_sen BIGINT,
  ADD COLUMN IF NOT EXISTS payout_floor_sen BIGINT NOT NULL DEFAULT 0;

UPDATE public.order_settlements SET base_fee_sen = platform_fee_sen WHERE base_fee_sen IS NULL;
ALTER TABLE public.order_settlements ALTER COLUMN base_fee_sen SET NOT NULL;
ALTER TABLE public.order_settlements DROP CONSTRAINT IF EXISTS order_settlements_base_fee_sen_check;
ALTER TABLE public.order_settlements ADD CONSTRAINT order_settlements_base_fee_sen_check CHECK (base_fee_sen >= 0);

-- ── 5. Fee floor: platform fee >= referral payouts owed on the order ─────────
-- Idempotent: the target is recomputed from base_fee_sen each call, so it can
-- run after settlement and again after attribution in either order. Only
-- untouched pending rows move; held vendor earnings are adjusted to match.

CREATE OR REPLACE FUNCTION public.apply_order_platform_fee_floor(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_affiliate_sen BIGINT;
  v_order_gross   BIGINT;
  v_owed          BIGINT;
  v_target        BIGINT;
  v_delta         BIGINT;
  v_wallet_id     UUID;
  v_pending       BIGINT;
  v_adjusted      INT := 0;
  s               RECORD;
BEGIN
  SELECT COALESCE(SUM(ROUND(commission_amount * 100)), 0)::BIGINT INTO v_affiliate_sen
    FROM public.affiliate_attributions
   WHERE order_id = p_order_id AND status NOT IN ('rejected', 'reversed');
  SELECT COALESCE(SUM(gross_sen), 0)::BIGINT INTO v_order_gross
    FROM public.order_settlements WHERE order_id = p_order_id;

  FOR s IN
    SELECT os.id, os.vendor_id, os.gross_sen, os.platform_fee_sen, os.base_fee_sen,
           os.is_simulated, os.wallet_txn_id, v.owner_id
    FROM public.order_settlements os
    JOIN public.vendors v ON v.id = os.vendor_id
    WHERE os.order_id = p_order_id AND os.status = 'pending' AND os.reversed_amount_sen = 0
    ORDER BY os.id
    FOR UPDATE OF os
  LOOP
    -- The affiliate commission is on the whole order: share it by gross.
    v_owed := CASE WHEN v_order_gross > 0
                THEN ROUND(v_affiliate_sen::NUMERIC * s.gross_sen / v_order_gross)::BIGINT
                ELSE 0 END
      + COALESCE((
          SELECT ROUND(SUM(rc.amount) * 100)::BIGINT
          FROM public.recommendation_commissions rc
          JOIN public.recommendation_conversions c ON c.id = rc.conversion_id
          WHERE rc.order_id = p_order_id AND c.converted_vendor_id = s.vendor_id
            AND rc.status NOT IN ('rejected', 'reversed', 'cancelled')
        ), 0);
    v_target := LEAST(s.gross_sen, GREATEST(s.base_fee_sen, v_owed));
    v_delta := v_target - s.platform_fee_sen;
    IF v_delta = 0 THEN CONTINUE; END IF;

    -- Move held earnings only when the settlement actually credited a wallet.
    IF NOT s.is_simulated AND s.wallet_txn_id IS NOT NULL AND s.owner_id IS NOT NULL THEN
      SELECT id, pending_earnings_sen INTO v_wallet_id, v_pending
        FROM public.wallets WHERE user_id = s.owner_id FOR UPDATE;
      IF NOT FOUND OR (v_delta > 0 AND v_pending < v_delta) THEN
        CONTINUE; -- never fail the caller (payment trigger); the next call retries
      END IF;
      UPDATE public.wallets
         SET pending_earnings_sen = pending_earnings_sen - v_delta, updated_at = now()
       WHERE id = v_wallet_id;
      IF v_delta > 0 THEN
        INSERT INTO public.wallet_transactions (user_id, wallet_id, order_id, type, amount_sen, bucket, direction, note)
        VALUES (s.owner_id, v_wallet_id, p_order_id, 'earnings_reverse', v_delta, 'pending_earnings', 'debit',
                'Platform fee raised to cover referral payouts on this order');
      ELSE
        INSERT INTO public.wallet_transactions (user_id, wallet_id, order_id, type, amount_sen, bucket, direction, note)
        VALUES (s.owner_id, v_wallet_id, p_order_id, 'earnings_pending', -v_delta, 'pending_earnings', 'credit',
                'Platform fee floor released after a referral payout was cancelled');
      END IF;
    END IF;

    UPDATE public.order_settlements
       SET platform_fee_sen = v_target, vendor_net_sen = gross_sen - v_target, payout_floor_sen = v_owed
     WHERE id = s.id;
    v_adjusted := v_adjusted + 1;
  END LOOP;

  RETURN jsonb_build_object('adjusted', v_adjusted, 'order_id', p_order_id);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_order_platform_fee_floor(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_order_platform_fee_floor(UUID) TO service_role;

-- ── 6. Settlement: per-line tier/event fee ───────────────────────────────────
-- Full replacement of the live definition (20260911000000 as patched by
-- 20261002145304). Fail loudly if it has drifted from what this was written
-- against.

DO $guard$
DECLARE d TEXT := pg_get_functiondef('public.settle_order_vendor_earnings(uuid)'::regprocedure);
BEGIN
  IF position('v_simulated BOOLEAN' IN d) = 0
     OR position('(SELECT platform_commission_rate FROM public.vendors WHERE id = r.vendor_id)' IN d) = 0
     OR position('v_fee_sen := ROUND(v_gross_sen * v_rate)::BIGINT;' IN d) = 0
     OR position('IF v_simulated OR v_net_sen <= 0 THEN' IN d) = 0 THEN
    RAISE EXCEPTION 'settlement_definition_drift';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.settle_order_vendor_earnings(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order         public.orders%ROWTYPE;
  v_total_sen     BIGINT;
  v_subtotal      NUMERIC;
  v_hold_days     INT;
  v_global_rate   NUMERIC;
  v_event_default BIGINT;
  v_allocated     BIGINT := 0;
  v_settled       INT := 0;
  v_simulated     BOOLEAN;
  v_owner_id      UUID;
  v_wallet_id     UUID;
  v_rate          NUMERIC;
  v_gross_sen     BIGINT;
  v_fee_sen       BIGINT;
  v_net_sen       BIGINT;
  v_txn_id        UUID;
  v_settlement_id UUID;
  v_tier_rank     SMALLINT;
  v_tier_type     TEXT;
  v_tier_rate     NUMERIC;
  v_tier_per_item BIGINT;
  v_line_alloc    BIGINT;
  v_line_gross    BIGINT;
  v_line_qty      INT;
  v_per_item      BIGINT;
  v_pct_gross     BIGINT;
  v_fixed_fee     BIGINT;
  v_items         INT;
  v_snap_per_item BIGINT;
  v_per_item_mix  BOOLEAN;
  v_has_event     BOOLEAN;
  v_has_tier      BOOLEAN;
  v_has_fixed     BOOLEAN;
  r               RECORD;
  li              RECORD;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('settled', 0, 'reason', 'order_not_found'); END IF;
  IF LOWER(v_order.status) NOT IN ('paid', 'completed') THEN
    RETURN jsonb_build_object('settled', 0, 'reason', 'order_not_paid');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.payments WHERE order_id = p_order_id AND status = 'succeeded') THEN
    RETURN jsonb_build_object('settled', 0, 'reason', 'successful_payment_missing');
  END IF;
  v_simulated := NOT EXISTS (SELECT 1 FROM public.payments WHERE order_id = p_order_id AND status = 'succeeded' AND is_live);
  v_total_sen := ROUND(v_order.total_amount * 100)::BIGINT;
  v_subtotal  := NULLIF(v_order.subtotal, 0);

  SELECT COALESCE(
    (SELECT NULLIF(value, '')::INT FROM public.platform_settings WHERE key = 'wallet.clearance_days'),
    (SELECT NULLIF(value, '')::INT FROM public.platform_settings WHERE key = 'earnings.hold_days'),
    7
  ) INTO v_hold_days;
  IF v_hold_days IS NULL OR v_hold_days < 1 OR v_hold_days > 30 THEN v_hold_days := 7; END IF;

  SELECT NULLIF(value, '')::NUMERIC INTO v_global_rate
    FROM public.platform_settings WHERE key = 'commission.platform_rate';
  IF v_global_rate IS NULL OR v_global_rate < 0 OR v_global_rate >= 1 THEN v_global_rate := 0.15; END IF;

  SELECT CASE WHEN value ~ '^[0-9]{1,6}$' THEN value::BIGINT END INTO v_event_default
    FROM public.platform_settings WHERE key = 'platform_fee.event_per_item_sen';
  IF v_event_default > 100000 THEN v_event_default := NULL; END IF;

  FOR r IN
    SELECT oi.vendor_id,
           SUM(oi.line_total) AS line_sum,
           ROW_NUMBER() OVER (ORDER BY oi.vendor_id) AS rn,
           COUNT(*) OVER () AS row_count
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id AND oi.vendor_id IS NOT NULL
    GROUP BY oi.vendor_id
  LOOP
    -- Pro-rata share of the discounted order total; the last vendor absorbs the
    -- rounding remainder so SUM(gross_sen) = total_amount exactly.
    IF v_total_sen <= 0 OR v_subtotal IS NULL THEN
      v_gross_sen := 0;
    ELSIF r.rn = r.row_count THEN
      v_gross_sen := GREATEST(0, v_total_sen - v_allocated);
    ELSE
      v_gross_sen := ROUND(v_total_sen * (r.line_sum / v_subtotal))::BIGINT;
    END IF;
    v_allocated := v_allocated + v_gross_sen;

    -- The vendor's tier: admin pin first, else the nightly sales placement.
    SELECT COALESCE(v.fee_tier_pinned, v.fee_tier_rank) INTO v_tier_rank
      FROM public.vendors v WHERE v.id = r.vendor_id;
    SELECT t.fee_type, t.percent_rate, t.fixed_per_item_sen INTO v_tier_type, v_tier_rate, v_tier_per_item
      FROM public.vendor_fee_tiers t WHERE t.rank = v_tier_rank;
    IF NOT FOUND THEN
      v_tier_rank := NULL; v_tier_type := 'percent'; v_tier_rate := v_global_rate; v_tier_per_item := NULL;
    END IF;

    -- Per line: event lines pay the event fee per item, the rest the tier fee.
    -- Percent lines are pooled and rounded once, so a single-rate vendor pays
    -- exactly ROUND(gross × rate) as before.
    v_line_alloc := 0; v_pct_gross := 0; v_fixed_fee := 0; v_items := 0;
    v_snap_per_item := NULL; v_per_item_mix := FALSE;
    v_has_event := FALSE; v_has_tier := FALSE; v_has_fixed := FALSE;
    FOR li IN
      SELECT oi.quantity, COALESCE(oi.line_total, 0) AS line_total,
             oi.event_location_id IS NOT NULL AS is_event,
             c.platform_fee_per_item_sen AS campaign_fee,
             ROW_NUMBER() OVER (ORDER BY oi.id) AS rn,
             COUNT(*) OVER () AS n
      FROM public.order_items oi
      LEFT JOIN public.promotion_campaign_locations l ON l.id = oi.event_location_id
      LEFT JOIN public.promotion_campaigns c ON c.id = l.campaign_id
      WHERE oi.order_id = p_order_id AND oi.vendor_id = r.vendor_id
    LOOP
      IF li.rn = li.n THEN
        v_line_gross := GREATEST(0, v_gross_sen - v_line_alloc);
      ELSIF COALESCE(r.line_sum, 0) <= 0 THEN
        v_line_gross := 0;
      ELSE
        v_line_gross := LEAST(GREATEST(0, v_gross_sen - v_line_alloc),
                              ROUND(v_gross_sen * (li.line_total / r.line_sum))::BIGINT);
      END IF;
      v_line_alloc := v_line_alloc + v_line_gross;
      v_line_qty := GREATEST(COALESCE(li.quantity, 1), 0);
      v_items := v_items + v_line_qty;

      v_per_item := CASE WHEN li.is_event THEN COALESCE(li.campaign_fee, v_event_default) END;
      IF v_per_item IS NOT NULL THEN
        v_has_event := TRUE;
      ELSE
        v_has_tier := TRUE;
        v_per_item := CASE WHEN v_tier_type = 'fixed' THEN v_tier_per_item END;
      END IF;

      IF v_per_item IS NULL THEN
        v_pct_gross := v_pct_gross + v_line_gross;
      ELSE
        v_has_fixed := TRUE;
        v_fixed_fee := v_fixed_fee + LEAST(v_per_item * v_line_qty, v_line_gross);
        IF v_snap_per_item IS NULL THEN v_snap_per_item := v_per_item;
        ELSIF v_snap_per_item <> v_per_item THEN v_per_item_mix := TRUE;
        END IF;
      END IF;
    END LOOP;

    v_rate := CASE WHEN v_pct_gross > 0 OR NOT v_has_fixed THEN v_tier_rate ELSE 0 END;
    IF v_rate IS NULL OR v_rate < 0 OR v_rate >= 1 THEN v_rate := v_global_rate; END IF;
    v_fee_sen := LEAST(v_gross_sen, v_fixed_fee + ROUND(v_pct_gross * v_rate)::BIGINT);
    v_net_sen := GREATEST(0, v_gross_sen - v_fee_sen);

    INSERT INTO public.order_settlements
      (order_id, vendor_id, gross_sen, platform_rate, platform_fee_sen, vendor_net_sen,
       status, hold_until, is_simulated,
       fee_type, fee_source, fee_per_item_sen, fee_tier_rank, item_count, base_fee_sen)
    VALUES
      (p_order_id, r.vendor_id, v_gross_sen, v_rate, v_fee_sen, v_net_sen,
       'pending', now() + (v_hold_days || ' days')::INTERVAL, v_simulated,
       CASE WHEN NOT v_has_fixed THEN 'percent' WHEN v_pct_gross > 0 THEN 'mixed' ELSE 'fixed' END,
       CASE WHEN v_has_event AND v_has_tier THEN 'mixed' WHEN v_has_event THEN 'event' ELSE 'tier' END,
       CASE WHEN v_per_item_mix THEN NULL ELSE v_snap_per_item END,
       CASE WHEN v_has_tier THEN v_tier_rank END,
       v_items, v_fee_sen)
    ON CONFLICT (order_id, vendor_id) DO NOTHING
    RETURNING id INTO v_settlement_id;

    IF v_settlement_id IS NULL THEN
      CONTINUE; -- already settled (idempotent)
    END IF;
    v_settled := v_settled + 1;

    IF v_simulated OR v_net_sen <= 0 THEN
      CONTINUE; -- nothing to move (free reservation / fully-discounted line)
    END IF;

    SELECT owner_id INTO v_owner_id FROM public.vendors WHERE id = r.vendor_id;
    IF v_owner_id IS NULL THEN CONTINUE; END IF;

    SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = v_owner_id FOR UPDATE;
    IF v_wallet_id IS NULL THEN
      INSERT INTO public.wallets (user_id) VALUES (v_owner_id)
      ON CONFLICT (user_id) DO NOTHING;
      SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = v_owner_id FOR UPDATE;
    END IF;

    UPDATE public.wallets
       SET pending_earnings_sen = pending_earnings_sen + v_net_sen,
           updated_at = now()
     WHERE id = v_wallet_id;

    INSERT INTO public.wallet_transactions
      (user_id, wallet_id, order_id, idempotency_key, type, amount_sen, bucket, direction, note)
    VALUES
      (v_owner_id, v_wallet_id, p_order_id,
       'vendor-settlement:pending:' || p_order_id::TEXT || ':' || r.vendor_id::TEXT,
       'earnings_pending', v_net_sen, 'pending_earnings', 'credit',
       'Vendor order settlement (held)')
    ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
    RETURNING id INTO v_txn_id;

    UPDATE public.order_settlements SET wallet_txn_id = v_txn_id WHERE id = v_settlement_id;
  END LOOP;

  -- Payouts attributed before settlement are covered here; ones attributed
  -- after call the floor again from /api/checkout/attribute.
  -- This runs inside the paid-order trigger: a floor failure must never block
  -- the payment, and the nightly maintenance pass re-applies it.
  IF v_settled > 0 THEN
    BEGIN
      PERFORM public.apply_order_platform_fee_floor(p_order_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'platform fee floor deferred for order %: %', p_order_id, SQLERRM;
    END;
  END IF;

  RETURN jsonb_build_object('settled', v_settled, 'order_id', p_order_id);
END;
$$;

REVOKE ALL ON FUNCTION public.settle_order_vendor_earnings(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_order_vendor_earnings(UUID) TO service_role;

-- ── 7. Nightly tier placement ────────────────────────────────────────────────
-- ponytail: partial refunds still count at full gross; subtract them if a
-- vendor near a threshold disputes it.

CREATE OR REPLACE FUNCTION public.recompute_vendor_fee_tiers()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_changed INT;
BEGIN
  WITH sales AS (
    SELECT v.id, v.fee_tier_rank AS old_rank, v.fee_tier_sales_sen AS old_sales,
           COALESCE(SUM(s.gross_sen), 0)::BIGINT AS sales_sen
    FROM public.vendors v
    LEFT JOIN public.order_settlements s
      ON s.vendor_id = v.id AND s.status IN ('pending', 'confirmed') AND NOT s.is_simulated
     AND s.created_at >= now() - INTERVAL '90 days'
    GROUP BY v.id
  ), ranked AS (
    SELECT sales.*,
           COALESCE((SELECT MAX(t.rank) FROM public.vendor_fee_tiers t WHERE t.min_sales_sen <= sales.sales_sen), 1)::SMALLINT AS new_rank
    FROM sales
  ), updated AS (
    UPDATE public.vendors v
       SET fee_tier_rank = ranked.new_rank, fee_tier_sales_sen = ranked.sales_sen, fee_tier_evaluated_at = now()
      FROM ranked
     WHERE v.id = ranked.id
       AND (ranked.new_rank <> ranked.old_rank OR ranked.sales_sen <> ranked.old_sales OR v.fee_tier_evaluated_at IS NULL)
    RETURNING ranked.new_rank <> ranked.old_rank AS moved
  )
  SELECT COUNT(*) FILTER (WHERE moved) INTO v_changed FROM updated;
  RETURN v_changed;
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_vendor_fee_tiers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_vendor_fee_tiers() TO service_role;

SELECT public.recompute_vendor_fee_tiers();
