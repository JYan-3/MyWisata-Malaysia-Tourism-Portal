-- Server-side referral attribution (Docs/plans/2026-10-08-2216-server-side-referral-attribution.md).
--
-- orders.paid_effects_processed_at marks a paid order whose affiliate commission,
-- recommendation rewards and fee floor have run (lib/orders/paid-order-effects.ts).
-- The 5-minute job picks up paid orders where it is still empty.

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS paid_effects_processed_at TIMESTAMPTZ;

-- Every order that already exists was handled (or missed) by the old flow. Mark
-- them done so the first job run never pays rewards retroactively. Orders still
-- awaiting payment stay open and are processed once they are paid. The
-- updated_at trigger is paused so old orders do not all look freshly modified.
ALTER TABLE public.orders DISABLE TRIGGER trg_orders_updated_at;
UPDATE public.orders
   SET paid_effects_processed_at = now()
 WHERE paid_effects_processed_at IS NULL
   AND status <> 'pending_payment';
ALTER TABLE public.orders ENABLE TRIGGER trg_orders_updated_at;

CREATE INDEX IF NOT EXISTS orders_paid_effects_pending_idx
  ON public.orders (created_at)
  WHERE paid_effects_processed_at IS NULL AND status IN ('paid', 'completed');

-- Affiliate attribution window: every purchase within 7 days of the buyer's
-- last click on an affiliate link earns a commission (Shopee-style, decided
-- 2026-10-08). Used for the cookie lifetime and the expiry check.
INSERT INTO public.platform_settings (key, value)
VALUES ('affiliate.cookie_days', '7')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
