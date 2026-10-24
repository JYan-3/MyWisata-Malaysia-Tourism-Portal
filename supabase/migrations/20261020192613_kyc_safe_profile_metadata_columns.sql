-- Keep the deployed profile summary working without exposing KYC evidence columns.
GRANT SELECT (user_id, status, review_reason_code, reviewed_at, created_at)
ON TABLE public.kyc_submissions TO authenticated;
