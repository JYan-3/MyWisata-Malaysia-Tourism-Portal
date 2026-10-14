# KYC Evidence Protection

Status: Implemented; local automated verification passed. Deployment/scheduler execution pending.
Created: 2026-10-12 04:12 Asia/Kuala_Lumpur

## Context and decisions
Protect uploaded IC front/back without government or commercial eKYC. Existing OCR is text matching, not authenticity or holder verification. External OCR must fail closed unless the operator explicitly confirms suitable paid-provider data processing. Manual review remains available. New stored evidence receives a permanent repeated purpose watermark; original bytes are decoded/re-encoded without metadata for OCR and never additionally stored. Historical evidence is not rewritten.

## Reuse Decisions
- Extend app/api/kyc/upload/route.ts POST using lib/kyc/submission.ts validation, path generation and cleanup.
- Extend lib/kyc/ocr.ts runKycOcr with explicit provider opt-in; retain unavailable/manual-review behavior.
- Extend app/api/admin/kyc/documents/[submissionId]/[side]/route.ts GET using requireStaffPermission and get_kyc_document_view audit RPC, replacing signed URLs with authenticated bytes.
- Extend components/admin/kyc-review-detail.tsx openDocument using existing errors/feedback and a revocable blob URL.
- Extend app/api/cron/purge-kyc-evidence/route.ts with GET for Vercel scheduling; reuse POST and deletion-confirmation protocol. Add daily schedule to vercel.json.
- Reuse installed sharp in new domain-specific lib/kyc/evidence-image.ts; no existing watermark helper found. Public product-image URL helpers and client avatar Canvas rejected: wrong authorization/runtime/domain.
- Extend existing route/OCR tests; add image tests for real decoding, metadata stripping and changed pixels.

## Phases and exact files
1. Add failing tests in lib/kyc/__tests__/ocr.test.ts, lib/kyc/__tests__/evidence-image.test.ts, app/api/admin/kyc/documents/[submissionId]/[side]/__tests__/route.test.ts, app/api/cron/purge-kyc-evidence/__tests__/route.test.ts and app/api/kyc/upload/__tests__/route.test.ts.
2. Modify functions/files above and add lib/kyc/evidence-image.ts (prepareKycEvidenceImage). Validate bounded pixel count, rotate and re-encode preserving accepted MIME; strip metadata, composite fixed-purpose repeated watermark. Stop invalid images before starting submissions.
3. Document deployment settings, provider opt-in, scheduling/retention verification and historical-evidence limitation here.

## Boundaries
No database changes, new dependencies, MFA rollout, liveness/face verification, payment/approval-rule changes, unrelated UI/components or historical-file rewrites. Leave finalizer-trace.out untouched.

## Risks
Operator confirmation is configuration, not independent billing verification. Cron requires deployment and CRON_SECRET; existing retention policy retained. Existing photos remain unwatermarked. Authenticated viewing cannot prevent screenshots. Invalid/oversized decoded images must fail before creating drafts. Provider failures must retain manual review.

## Verification
Run focused Vitest tests, npm run lint, npx tsc --noEmit. One bounded luna_worker security review after implementation. Production billing, deployed RLS and scheduled purge execution need external runtime evidence; do not claim verified.

## Operator configuration and verified outcomes
- KYC_EXTERNAL_OCR_ENABLED is disabled by default. Leave unset/false for manual KYC review without external image transmission. Set true only after verifying the Gemini project has active billing and appropriate data processing/consent; GOOGLE_AI_KEY alone no longer enables KYC OCR. No paid plan or credentials were changed.
- Set CRON_SECRET in the deployed environment. Deploy vercel.json; daily schedule 0 4 * * * is 04:00 UTC / 12:00 Asia/Kuala_Lumpur. Confirm scheduler invocation and successful aggregate counts in deployment logs. Partial deletion failures return 502; claims become retryable after one hour.
- Read-only query against linked FYP Supabase project on 2026-10-12 confirmed purge_expired_kyc_evidence and confirm_purged_kyc_evidence are installed. No live purge or schema modification performed.
- Existing rules: rejected/superseded evidence becomes eligible after 90 days; approved evidence after account deletion or approved replacement plus 90 days. Active approved evidence is not automatically purged 90 days after initial approval. Retention was not shortened without a product decision.
- Historical PDF viewing preserved through the authenticated byte endpoint; no historical photos rewritten.
- Verification: 62 affected tests passed before final historical-PDF compatibility repair; document route tests then passed all 4 cases. Full lint passed with 85 existing warnings and no errors; changed-file lint passed without warnings. TypeScript check passed. Independent luna_worker privacy review identified PDF compatibility regression, repaired within scope.
- Limitations: no browser/live upload journey, deployed cron execution or provider billing verified. Purpose watermark does not establish document authenticity or live holder identity. Blob display cannot prevent screenshots; URLs revoked after 60 seconds.

## Main release validation (2026-10-12)
User confirmed Hostinger consumes GitHub main automatically approximately five minutes after push; no Git-provider reconnection required. Release prepared from current origin/main 3864d29b in managed worktree, preserving main dependencies and unrelated cron entries. npm ci completed; 63 affected tests passed; full lint had 0 errors / 93 warnings; tsc --noEmit and production build passed. Main publication authorized by user. Hostinger scheduler configuration and deployed verification are separate acceptance steps.

## Deployment record (2026-10-12 Asia/Kuala_Lumpur)
- Published ea6c973f4b26d80323b54b136519c5c317da3e0b to source main via ordinary fast-forward push.
- Existing teacher sync workflow run 38192145919 succeeded, advancing JYan-3/main to the same commit.
- Source CI run 38191881392 completed successfully, including full tests and production build.
- Hostinger deployment details show Completed / Current at 09:34, commit ea6c973f, source JYan-3/main, elapsed 4m 3s.
- Live unauthenticated GET /api/cron/purge-kyc-evidence returned 401 (previous version returned 405); admin document GET returned 401 without storage details.
- Hostinger daily cleanup command prepared for 0 4 * * *, loading CRON_SECRET from the existing server environment file. Save attempts did not create a visible task or show an error. User assistance requested; actual scheduled invocation remains unverified. No live purge triggered.
- Historical photos unchanged; authenticated real-document viewing/upload not exercised against production.

## Hostinger scheduler acceptance
Daily KYC purge task was successfully created in Hostinger using the same authenticated curl format as the existing email-outbox task, with only the endpoint changed to /api/cron/purge-kyc-evidence. Actual Hostinger schedule: 0 0 * * * (daily); this supersedes the earlier proposed 0 4 * * * Hostinger time. Reload confirmed the new task remains in the list alongside the original email job. Command uses curl -fsS --max-time 60 and existing CRON_SECRET authorization. No new key or permission created, no secret copied into repository/documentation. No manual purge triggered. First scheduled execution and its View Output remain future runtime evidence; task creation/persistence are verified.
