# KYC Monitoring and Reviewer MFA

Status: Approved by user; implementation in progress.
Created: 2026-10-12 23:37 Asia/Kuala_Lumpur

## Context and evidence

Complete four remaining protections: purge execution evidence, purge failure/missed-run alerts, reviewer MFA, and abnormal document-view alerts. Third-party OCR is deferred and untouched.

Read existing Docs inventory, ADR-029, the July KYC security design, and the October evidence-protection plan. Documentation in the original checkout is available even where ignored Docs files are absent from the managed checkout. The October plan records that Hostinger now persists the daily `0 0 * * *` authenticated purge task; its first scheduled execution is still unverified.

Repository and independent luna_worker inspection found four KYC admin APIs protected by permission checks without MFA, authenticated direct review/claim RPCs, and an unused legacy review RPC. Live read-only catalog inspection confirmed authenticated execute on legacy public/private review_kyc and direct reviewer SELECT on kyc_submissions. Document rows and review events currently deny ordinary client access. No identity files were downloaded or changed during discovery.

## Decisions and alternatives

Recommended: Supabase TOTP with a user-owned authenticator; existing notification center plus email outbox for alerts. This avoids a new vendor/dependency. Email-only alerts are simpler but provide less durable visibility; a separate monitoring vendor could detect complete host outages but requires credentials and service decisions outside this task.

1. Require AAL2 for the KYC queue, detail/claim, document bytes, and review decisions. Offer enrollment/challenge at a KYC-specific admin MFA page. The reviewer scans their own QR and verifies a code; the agent never enrolls a factor for them. Never persist or log QR, factor secret, OTP, or tokens. Validate Supabase TOTP configuration before enabling the gate. Use current authenticated session assurance, not factor existence alone.
2. Enforce the same boundary inside the modern claim/review RPC implementations and reviewer branch of submission SELECT RLS. Preserve customer-own access and service-role cleanup. Revoke authenticated access to unused legacy review_kyc, including its app_private implementation. Keep pure permission lookups unchanged so service checks and notification recipient selection still work.
3. Record purge start, completion, aggregate claimed/purged/failed counts, and fixed failure codes in a service-only ledger. An empty successful run is a valid heartbeat. Record unexpected exceptions/partial failures; a crashed process is detected as an incomplete run. No paths, ICs, names, files, raw provider errors, or credentials enter the ledger/alerts/logs.
4. Reuse the existing protected five-minute email cron to check purge health independently of the daily purge job, before processing the outbox. Alert on failed/partial purge, an incomplete run older than 15 minutes, or no successful completion for 26 hours after monitoring activation. Deduplicate incidents, retry durable notification/email writes, and resolve a missed-run incident when a subsequent run succeeds. Monitor errors must not prevent ordinary email processing; return a failure status when monitoring itself fails.
5. Generate a document-access alert when one reviewer requests document access for at least 10 distinct submissions within a rolling 10 minutes. Count front/back/reopens once per submission; use existing audit events and atomic server-side incident deduplication. Treat this as suspicious access activity, not proof of successful downloads or wrongdoing. Do not automatically suspend reviewers or block legitimate bulk review.
6. User clarified that the existing KYC Approval role should be reused. Alert active users with effective admin.kyc.review authority, including authorized custom KYC reviewers, excluding the anomalous-access actor. Do not include ordinary customers or vendor-scoped roles without this effective permission. No roles or assignments are created by this task. Verify that at least one suitable recipient exists before rollout. Alert content contains incident kind, counts, time and a protected admin link; no customer identifiers or document references. Use separate typed security email rendering, not wallet/transaction templates.
7. Show aggregate purge health and recent security incidents in the KYC admin area after MFA. Avoid a new global admin dashboard or notification-center rewrite.

## Reuse Decisions

| Candidate / exact path | Reuse | Decision / reason |
| --- | --- | --- |
| app/api/cron/purge-kyc-evidence/route.ts | Authenticated GET/POST, claim/remove/confirm protocol | Extend with run ledger and fixed failure codes; preserve retention rules |
| app/api/cron/process-email-outbox/route.ts | Existing deployed five-minute authenticated job | Extend with independent purge-health check; retain email processing even if monitor fails |
| public.purge_expired_kyc_evidence / confirm_purged_kyc_evidence | Authoritative eligibility, deletion confirmation and retries | Reuse, no changed eligibility or retention |
| lib/staff-permissions/server.ts | getUser and effective permission enforcement | Reuse from KYC-specific wrapper; do not impose MFA on all staff domains |
| lib/supabase/client.ts and lib/supabase/server.ts | Existing Auth SDK/session clients | Reuse after verifying exact exported client helpers |
| lib/auth/safe-next.ts | Safe local return path | Reuse and additionally restrict MFA return paths to admin KYC |
| components/admin/admin-page-shell.tsx | Page/header/metric primitives and tokens | Reuse for MFA and aggregate health UI |
| components/ui/input.tsx, button.tsx, dialog.tsx | Existing accessible UI primitives | Reuse; no new shared abstraction |
| components/admin/kyc-review-detail.tsx and app/admin/kyc/page.tsx | Existing fetch/error flows | Extend to handle MFA-required responses and preserve safe return |
| get_kyc_document_view and audit_logs | Existing authorized document-access audit | Extend service-only audit/alert transaction without returning storage paths |
| components/shared/notification-center.tsx and notification-bell.tsx | Existing account_security display | Reuse unchanged unless a verified contract needs a small extension |
| lib/notifications/localize.ts | Typed notification localization | Extend security event mapping |
| lib/email/outbox.ts, sender.ts, templates.ts | Persistent deduplicated email queue, retries and rendering | Extend with typed KYC security event |
| lib/wallet/approver-notifications.ts | Active-recipient/deduplication pattern | Reject its wallet role filter and catch-and-swallow fanout; use global KYC oversight recipient contract and durable atomic enqueue |
| backend/core/audit.ts / record_audit_and_notify | Approval-specific audit/notification coupling | Reject for cron: assumes authenticated admin, accepts arbitrary recipients, and does not provide service-job health |
| Existing route, migration boundary and localization tests | Authorization and schema-history contracts | Extend affected coverage, update exact migration inventory |

Reuse audit complete. No existing MFA enrollment/challenge UI, purge run ledger, active purge failure/missed-run notification, or document-volume alert implementation was found.

## Phases and exact files/functions

### 1. Database boundaries and durable monitoring

- Allocated with Supabase CLI: supabase/migrations/20261012154500_kyc_security_monitoring.sql and supabase/migrations/20261012154530_kyc_reviewer_mfa_boundaries.sql. Existing migration filenames remain unchanged. Apply the MFA migration after the compatible UI is deployed.
- Modify only KYC-related current RPC bodies/policies: app_private.claim_kyc_submission, app_private.admin_review_kyc, legacy review_kyc grants, kyc_submissions reviewer SELECT branch, public.get_kyc_document_view.
- Add service-only job-run/incident tables and service-only start/finish/check-monitoring/record-alert RPCs. Use fixed schema validation, bounded retention for operational records, deduplication keys and restricted grants. Reuse current effective staff-permission functions for oversight recipients and current notifications/email_outbox for atomic enqueue.
- Extend email_outbox event-type check additively without discarding existing allowed types.
- Update supabase/migrations/__tests__/canonical-history.test.ts and add focused migration boundary tests for the allocated migration names.
- Inspect current live definitions before composing SQL; use apply_migration for deployment, never speculative historical function copies.

### 2. Server job and alert handling

- app/api/cron/purge-kyc-evidence/route.ts: POST/GET records every authenticated run; handle claim/storage/confirm errors and thrown exceptions without leaking provider messages; failed completion writes produce non-success response.
- app/api/cron/process-email-outbox/route.ts: GET calls health monitor before normal processEmailOutbox and reports monitor failures safely.
- New lib/kyc/security-monitor.ts: typed service-only RPC adapters for run lifecycle, monitoring checks and aggregate health projection. No browser Supabase service key.
- lib/email/templates.ts, lib/email/sender.ts, lib/email/outbox.ts: typed security subject/render/send/process branch and minimum event payload.
- lib/notifications/localize.ts and app/i18n/locales/{en,ms,zh-CN}/common.json: security event display.

### 3. Reviewer MFA and aggregate health

- New lib/kyc/reviewer-auth.ts: requireKycReviewer wraps existing permission gate, then requires authenticated AAL2; auth/assurance errors fail closed.
- app/api/admin/kyc/submissions/route.ts, submissions/[submissionId]/route.ts, documents/[submissionId]/[side]/route.ts, review/route.ts: use reviewer gate before data/RPC/service downloads.
- New app/admin/kyc/mfa/page.tsx and components/admin/kyc-mfa.tsx: enrollment/challenge UI with existing primitives; private/no-cache QR handling, verified-factor challenge, clear cancel/error/retry state. Setup is available at AAL1 to authorized KYC staff but does not expose KYC data.
- app/admin/kyc/page.tsx and components/admin/kyc-review-detail.tsx: handle MFA-required results with safe return to queue/detail. Show aggregate health in queue using existing page primitives.
- New app/api/admin/kyc/security-status/route.ts: AAL2/permission-protected aggregate health/incident projection, no identity evidence paths or customer information.
- app/i18n/locales/{en,ms,zh-CN}/admin.json: MFA setup/challenge, status and errors.

### 4. Tests and verification

- Extend existing app/api/admin/kyc/*/__tests__, purge route tests, email cron route tests and lib/email/notifications tests; add lib/kyc/__tests__/reviewer-auth.test.ts, security-monitor.test.ts and components/admin/__tests__/kyc-mfa.test.tsx.
- Verify AAL1 denied/AAL2 accepted, stale session/assurance failures denied, both direct and app_private modern RPC MFA boundaries, legacy RPC revocation, reviewer SELECT denial at AAL1 while customer-own remains available.
- Verify empty-run heartbeat, partial/claim/thrown failures, incomplete/missed run detection, incident recovery/deduplication, distinct-submission threshold, recipient filtering and payload privacy. Simulate failures in isolated tests, not by breaking production storage.
- Run affected tests once after final changes, npm run lint and npx tsc --noEmit. Run production build for new routes/UI and one bounded luna_worker privacy/authorization review. Repair only confirmed blocking findings; at most one focused re-review.

## Rollout and runtime acceptance

- Check TOTP availability, alert recipient availability and deployed CRON_SECRET without exposing secrets. Coordinate additive migrations before application deployment, allowing current code to operate until MFA activation. Do not enable restrictive DB MFA gates ahead of the compatible MFA UI.
- Publish through existing source-main / teacher-main sync / Hostinger deployment flow; no Git-provider reconnection.
- Preserve Hostinger daily purge schedule and existing five-minute email job; no duplicate task required.
- Before manually invoking the production retention job, obtain only aggregate eligible counts. Execution deletes only evidence already eligible under unchanged retention rules, never active evidence or arbitrary files just to test. This execution is included in proposed approval scope.
- Verify authenticated job response and durable completed ledger, protected endpoints' denial without authorization, monitoring invocation, and one controlled security alert delivered to an authorized operator. Do not expose recipient address publicly or send identity information in a test alert.
- Verify the next actual Hostinger scheduled invocation using timestamped ledger/output. Manual endpoint success alone cannot establish scheduler execution. If the next scheduled run lies beyond this session, report it as pending; continue later only with explicit user authorization for a follow-up.
- Reviewer completes their own authenticator binding. The agent cannot claim real MFA enrollment or a protected reviewer journey verified without that human step. Document administrative recovery using established Supabase factor-management authority; do not add a secret bypass or global MFA exemption.

## Boundaries, dependencies and risks

No new dependencies expected. Database changes are additive service-only monitoring schema, additive email event check, and targeted KYC MFA/RPC/RLS boundaries. No changes to OCR, image processing/watermark, storage server-only policy, retention period, upload/customer state flow, payments, wallet approvals, role model or unrelated staff MFA.

Files explicitly untouched: lib/kyc/ocr.ts, lib/kyc/ocr-policy.ts, lib/kyc/evidence-image.ts, app/api/kyc/upload/route.ts, existing storage-hardening migrations, wallet/payment APIs, sync workflow, and original checkout's unrelated work.

Risks: MFA activation interrupts review until enrollment; expired sessions need re-challenge; browser screenshots remain possible; threshold can flag legitimate high-volume review and should be tuned from observed use. A same-host watchdog cannot alert during total Hostinger/network/database outage, and email delivery depends on the current outbox/provider. Missing-run alerts resume after infrastructure recovery; independent external uptime monitoring is follow-up work. No suitable active oversight recipient blocks alert acceptance. Daily scheduler timing must be proven by runtime evidence, not inferred from the hPanel list.

## Approved implementation notes
- Added safeKycReviewNext to existing lib/auth/safe-next.ts and security types to existing lib/kyc/types.ts. No new dependency.
- Live effective-permission query finds one active KYC reviewer. A self-triggered anomalous-access incident has no second recipient and remains pending; no authority is silently assigned.

## Final review and local verification
- Independent luna_worker review completed; focused re-review approved explicit effective-permission checks and active/global Super Admin assignment overrides.
- Hardened lib/email/outbox.ts sent/failed state writes so persistence failures do not produce a success count. New security-event stale sending recovery is limited to that event family. No general outbox redesign.
- npm run lint: 0 errors / 93 existing warnings; npx tsc --noEmit passed; production build passed. Full test run: 4,934 passed / 42 skipped, one exact component-inventory failure. Added the localized components/admin/kyc-mfa.tsx to app/admin/__tests__/sitewide-i18n.contract.test.ts; its 24 tests pass. Full rerun passed: 4,936 tests / 1,075 files; 42 tests / 12 files skipped by existing environment guards. No live DB integration fixtures executed.
- User approved a separate Gmail +kyc staff identity after their requested addresses proved to be existing customer identities. No customer accounts converted or deleted; no password chosen by the agent. Existing module, staff-role and invitation model will be reused; invitation acceptance and MFA enrollment remain human actions.
