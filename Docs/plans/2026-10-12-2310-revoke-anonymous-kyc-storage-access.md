# Revoke anonymous KYC storage access

Status: Emergency containment authorized by user report "Critical — fix today"; verified live and locally.
Created: 2026-10-12 23:10 Asia/Kuala_Lumpur.

## Context
Live pg_policies confirmed anon_read_kyc_docs, anon_upload_kyc_docs and anon_update_kyc_docs grant anonymous SELECT/INSERT/UPDATE against kyc-documents despite private bucket setting. Public-key-only list returned data. No identity image downloaded. The previous KYC work verified application APIs but omitted live Storage RLS, so its safety assessment was incomplete. No repository SQL defines these policies; creation actor/time are unknown.

## Reuse Decisions
Reuse app/api/kyc/upload/route.ts POST, app/api/admin/kyc/documents/[submissionId]/[side]/route.ts GET and app/api/cron/purge-kyc-evidence/route.ts: all evidence operations use service role. Reject anonymous policies: they bypass application authorization and watermark processing. Existing file validation, watermark and private byte response remain unchanged. Reuse audit complete.

## Scope and files
Add supabase/migrations/20261012151058_revoke_anonymous_kyc_storage_access.sql only; drop the three named policies with IF EXISTS. Add this plan. No functions, application components, other storage policies, data, bucket settings, credentials or dependencies changed. No document deletion. Migration is additive; historical SQL remains untouched.

## Verification
Snapshot live policies; public-key list before/after without printing paths or reading image contents; check service-role metadata access; independent security review. Review broader cross-bucket policy predicates separately before asserting all storage access safe. Preserve current working changes and original untracked output.

## Risks
Policies are live configuration and can be reintroduced out of band. Lack of policy creation history means the cause/actor cannot be attributed. Anonymous access being possible is confirmed; actual historical image exfiltration is not established. Storage/access log investigation and any notification assessment remain separate incident-response work. Cross-bucket vendor_products manager branch needs independent review.

## Focused blocking repair
Independent review confirmed vendor-products permissive policies have an outlet-manager OR branch outside the bucket guard. Rather than change unrelated vendor behavior, add supabase/migrations/20261012151337_enforce_server_only_kyc_storage.sql: one RESTRICTIVE FOR ALL policy for anon/authenticated denying KYC, allowing other bucket predicates to behave as before. Service role bypass remains intact. Add security-contract regression test supabase/migrations/__tests__/20261012151337_enforce_server_only_kyc_storage.test.ts. This enforces the already-approved server-only KYC architecture even if unrelated permissive policies match or anonymous grants are reintroduced. Broader vendor policy correction remains separate follow-up.

## Verified outcomes
Supabase apply_migration recorded versions 20261012151058 and 20261012151337. New, untracked CLI-created files were aligned to those actual recorded versions before publication; no applied SQL body or existing migration was changed. Update approvedForwardMigrations in supabase/migrations/__tests__/canonical-history.test.ts in the same change.
Live: named anonymous policies absent; RESTRICTIVE ALL anon/authenticated KYC deny confirmed. Public-key list returns empty while server list works. Existing document HEAD anonymous 400 / service 200; no image bytes downloaded. Synthetic anonymous upload rejected (400), with no stored test object. Fifteen existing objects retained. Twenty-seven focused tests passed; full lint 0 errors / 93 existing warnings; tsc passed. Existing integration suite creates/deletes users and records and was not run against production.
Logs: last-24-hour storage aggregate showed no successful anonymous document GET in available results. This is a limited look, not proof of no exfiltration; ingestion and retention limits remain. No creation actor/time for policies established. Broader vendor-products policy issue remains follow-up, with KYC specifically shielded by restrictive guard.
Independent focused repair review: bucket guard accepted; migration inventory corrected; remote history confirmed applied. Review claim that original policies were named anon_upload/anon_update rejected using the actual captured live metadata (both have _kyc_docs suffix).
