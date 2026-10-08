-- Local disposable-fixture extension; run inside a rollback transaction.
ALTER TABLE public.orders ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS guest_subject_id uuid;
CREATE TABLE IF NOT EXISTS public.refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payment_id uuid, order_id uuid,
  amount numeric, reason text, status text, created_at timestamptz DEFAULT now(),
  wallet_topup_sen bigint, wallet_earnings_sen bigint, external_amount_sen bigint,
  funding_snapshot_at timestamptz
);
ALTER TABLE public.refunds
  ADD COLUMN IF NOT EXISTS wallet_topup_sen bigint,
  ADD COLUMN IF NOT EXISTS wallet_earnings_sen bigint,
  ADD COLUMN IF NOT EXISTS external_amount_sen bigint,
  ADD COLUMN IF NOT EXISTS funding_snapshot_at timestamptz;
-- The existing funding algorithm has its own financial lifecycle tests. This
-- spy proves the extended request still calls that boundary atomically.
CREATE OR REPLACE FUNCTION public.snapshot_order_refund_funding(p_refund_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('fixture.fail_refund_snapshot',true)='true' THEN
    RAISE EXCEPTION 'refund_funding_ledger_mismatch';
  END IF;
  UPDATE public.refunds SET wallet_topup_sen=0,wallet_earnings_sen=0,
    external_amount_sen=round(amount*100),funding_snapshot_at=now() WHERE id=p_refund_id;
END; $$;
