-- Support columns/tables for real audited checkout/refund functions; loopback only.
ALTER TABLE public.checkout_sessions ADD COLUMN currency text DEFAULT 'MYR';
ALTER TABLE public.orders DROP CONSTRAINT orders_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_status_check CHECK(lower(status) IN ('draft','pending_payment','paid','completed','cancelled','refunded'));
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS provider_payment_id text, ADD COLUMN failure_reason text, ADD COLUMN provider_create_status text DEFAULT 'not_started';
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_status_check CHECK(status IN ('pending','requires_action','succeeded','failed','cancelled','refunded'));
ALTER TABLE public.refunds ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now(), ADD COLUMN IF NOT EXISTS provider_failure_code text, ADD COLUMN IF NOT EXISTS provider_failure_message text, ADD COLUMN IF NOT EXISTS attempt_count integer DEFAULT 0;
CREATE TABLE IF NOT EXISTS public.wallets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid UNIQUE,topup_sen bigint DEFAULT 0,earnings_sen bigint DEFAULT 0,updated_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS public.wallet_transactions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,wallet_id uuid,order_id uuid,idempotency_key text,type text,amount_sen bigint,bucket text,direction text,note text);

CREATE TABLE public.checkout_wallet_reservations(checkout_session_id uuid PRIMARY KEY,user_id uuid,wallet_id uuid,topup_amount_sen bigint,earnings_amount_sen bigint,status text,idempotency_key text);
CREATE TABLE public.voucher_holds(id uuid PRIMARY KEY,voucher_id uuid,checkout_session_id uuid,user_id uuid,status text);
CREATE TABLE IF NOT EXISTS public.voucher_redemptions(voucher_id uuid,order_id uuid,user_id uuid,discount numeric,UNIQUE(voucher_id,order_id));
ALTER TABLE public.vouchers ADD COLUMN IF NOT EXISTS uses_count integer DEFAULT 0;
CREATE OR REPLACE FUNCTION public.is_admin(uid uuid) RETURNS boolean LANGUAGE sql AS $$SELECT public.is_super_admin(uid)$$;

ALTER TABLE public.wallets ADD COLUMN IF NOT EXISTS topup_sen bigint DEFAULT 0, ADD COLUMN IF NOT EXISTS earnings_sen bigint DEFAULT 0;
ALTER TABLE public.wallet_transactions ADD COLUMN IF NOT EXISTS wallet_id uuid, ADD COLUMN IF NOT EXISTS idempotency_key text, ADD COLUMN IF NOT EXISTS amount_sen bigint, ADD COLUMN IF NOT EXISTS bucket text, ADD COLUMN IF NOT EXISTS direction text, ADD COLUMN IF NOT EXISTS note text;
CREATE UNIQUE INDEX ON public.wallet_transactions(user_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE TABLE public.payment_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),provider text NOT NULL,provider_event_id text NOT NULL,checkout_session_id uuid,order_id uuid,event_type text NOT NULL,payload_hash text,created_at timestamptz DEFAULT now(),UNIQUE(provider,provider_event_id));
ALTER TABLE public.refunds ADD COLUMN IF NOT EXISTS provider_refund_id text,
 ADD COLUMN IF NOT EXISTS processed_by uuid, ADD COLUMN IF NOT EXISTS processed_at timestamptz;
INSERT INTO public.payments(order_id,method,provider,amount,status)
SELECT o.id,o.payment_method,'platform',o.total_amount,'succeeded' FROM public.orders o WHERE lower(o.status)='paid'
AND NOT EXISTS(SELECT 1 FROM public.payments p WHERE p.order_id=o.id);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS guest_subject_id uuid, ADD COLUMN IF NOT EXISTS contact_email text,
 ADD COLUMN IF NOT EXISTS contact_name text, ADD COLUMN IF NOT EXISTS contact_phone text, ADD COLUMN IF NOT EXISTS display_id text DEFAULT 'FIXTURE-ORDER';
ALTER TABLE public.checkout_sessions ADD COLUMN IF NOT EXISTS guest_subject_id uuid;
-- Spy at the already-tested secure Guest-token boundary; no email is sent.
CREATE OR REPLACE FUNCTION public.queue_guest_order_access(p_order_id uuid,p_event_key text,p_reason text)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO public.email_outbox(event_key,to_email,event_type,payload)
 SELECT p_event_key,contact_email,'vendor_event_update',jsonb_build_object('reason',p_reason,'guestAccessToken','local-only-token')
 FROM public.orders WHERE id=p_order_id AND user_id IS NULL AND guest_subject_id IS NOT NULL
 ON CONFLICT(event_key) DO NOTHING;
END; $$;
