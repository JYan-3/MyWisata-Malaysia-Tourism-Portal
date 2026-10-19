-- Minimal local-only payout schema. No provider request is made by this test.
ALTER TABLE public.users ADD COLUMN stripe_connect_account_id text, ADD COLUMN stripe_payouts_enabled boolean DEFAULT false;
ALTER TABLE public.wallets ADD COLUMN IF NOT EXISTS reserved_balance_sen bigint DEFAULT 0;
ALTER TABLE public.payout_destinations ADD COLUMN provider text, ADD COLUMN provider_reference text, ADD COLUMN verification_status text, ADD COLUMN cooldown_until timestamptz;
ALTER TABLE public.withdrawal_requests ALTER COLUMN wallet_id DROP NOT NULL;
ALTER TABLE public.withdrawal_requests ADD COLUMN payout_provider text, ADD COLUMN destination_provider_reference text,
 ADD COLUMN approval_cycle integer DEFAULT 1, ADD COLUMN payout_attempt_started_at timestamptz, ADD COLUMN payout_execution_claim_token uuid, ADD COLUMN payout_execution_claimed_at timestamptz,
 ADD COLUMN customer_reason text, ADD COLUMN customer_reason_category text, ADD COLUMN customer_visible_at timestamptz;
ALTER TABLE public.withdrawal_requests ADD COLUMN destination_label text, ADD COLUMN destination_provider text, ADD COLUMN destination_masked_ref text;
CREATE OR REPLACE FUNCTION public.resolve_user_capability(p_user uuid,p_capability text)
RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('allowed',coalesce((SELECT status='active' AND email_verified_at IS NOT NULL AND (p_capability<>'wallet.request_withdrawal' OR kyc_status='approved') FROM public.users WHERE id=p_user),false)) $$;
-- Historical request predates the new identity snapshot: never infer its phone.
INSERT INTO public.payout_destinations(id,user_id,dest_type,provider,provider_reference,verification_status)
VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','00000000-0000-0000-0000-000000000004','ewallet','tng_direct_credit','test_tng_destination','verified');
INSERT INTO public.withdrawal_requests(id,user_id,amount,status,destination_id,payout_provider,destination_provider_reference)
VALUES('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','00000000-0000-0000-0000-000000000004',50,'approved','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','tng_direct_credit','test_tng_destination');
