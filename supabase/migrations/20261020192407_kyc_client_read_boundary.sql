-- KYC submissions contain legacy document URLs and identity fingerprints.
-- Browser clients must use authenticated server routes with explicit projections.
ALTER TABLE public.kyc_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.kyc_submissions FROM PUBLIC, anon, authenticated;
