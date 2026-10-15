# Event production rollout and interrupted email delivery recovery

Status: Approved to execute by the user's explicit request to finish PR merge, deployment, Cron, inbox acceptance and email interruption recovery together.

## Context and decisions

Primary checkout `/Users/tanzhengyang/Documents/GitHub/MyWisata-Malaysia-Tourism-Portal`, branch `feature/event-part`, head `1d7ee954`. PR49 passed both CI runs and is mergeable. Hostinger currently deploys main@a4247c40; collaborator mode disables deployment. User was asked to switch to an authorized direct login while implementation continues. Test recipient is explicitly supplied in chat; do not write it into committed fixtures. All acceptance content is synthetic.

Root cause: the existing SMTP processor cannot recover abandoned sending rows, and a successful SMTP response followed by a failed/ambiguous sent-state write is converted to retryable failure. A timeout after DATA may mean the server already accepted the email. SMTP Message-ID supports investigation, not guaranteed deduplication.

Use a 15-minute internal worker lease (existing security monitor timeout), five existing automatic attempts and current batch limits. Track token, lease, whether SMTP started and accepted message reference. Recover expired claims that never started SMTP; quarantine in-flight/legacy unknown deliveries for explicit evidence-based resolution. Every update is token guarded and successful acknowledgement is idempotent. Disable the legacy unguarded claim protocol during the migration-to-deploy window so old workers fail closed rather than duplicate mail. KYC event producers, recipients and permissions remain unchanged; its old stale reset cannot make quarantined deliveries claimable.

No UI, business policy, dependency, payment amount, refund or customer lifecycle changes. No live financial transaction is used as a test. Activating the existing refund scheduler may process eligible queued refunds; inspect the queue and scope before activation. Deployment and real inbox receipt require separate actual evidence.

## Reuse Decisions

- Extend `lib/email/outbox.ts`: existing unique event keys, dispatcher and payload projections; no second queue.
- Extend `lib/email/sender.ts` and `lib/email/order-receipt.ts`; preserve all existing templates and SMTP config. Shared `lib/email/delivery.ts` has two concrete sender consumers and centralizes timeout/error classification plus the optional pre-send hook.
- Reuse `supabase/legacy-migrations/048_email_outbox.sql` and `079_wallet_hold_resume_notifications.sql` as existing queue/ACL/five-attempt contracts; add one forward migration, never modify deployed source. Reuse the lease/CAS approach in `supabase/migrations/20261002152921_trip_itineraries_and_outbox_leases.sql`, but reject blind retry because SMTP lacks provider idempotency.
- Reuse `public.audit_logs` and existing Super Admin predicate for evidence-based operator recovery. New `scripts/email-delivery-recovery.mjs` is service-only operations tooling, default read-only, no public endpoint or new credential.
- Extend existing outbox/SMTP/cron tests. Add real loopback Postgres token/concurrency/recovery tests and canonical migration inventory. No unrelated shared UI/style changes.
- Keep `app/api/cron/process-email-outbox/route.ts` and `app/api/internal/email-outbox/process/route.ts` secret boundaries. Report unknown deliveries as attention rather than success; log only fixed error codes.

**Reuse audit complete.**

## Exact files and ordered implementation

Modify `lib/email/outbox.ts` (`processEmailOutbox`); `lib/email/sender.ts` (transport boundary and optional delivery hook); `lib/email/order-receipt.ts` (same receipt boundary); `lib/email/events.ts` (fixed failure logs); `app/api/internal/email-outbox/process/route.ts`; `app/api/cron/process-email-outbox/route.ts`; affected existing `lib/email/__tests__` and route tests; `supabase/migrations/__tests__/canonical-history.test.ts`; `package.json` scripts only.

Create `lib/email/delivery.ts`, `lib/email/__tests__/delivery.test.ts`, `lib/email/__tests__/delivery-recovery.test.ts`, a CLI-generated forward `email_delivery_recovery` migration, `scripts/email-delivery-recovery.mjs`, `scripts/test-email-delivery-db.mjs`. No schema migration replay. New schema fields are service-only and contain attempt state, not copies of contacts or payloads.

1. Write failing tests: accepted SMTP + acknowledgement errors never re-send; safe connection failure can retry; DATA timeout cannot; claim token/lease race rejects stale worker; never-started crash recovers, in-flight crash quarantines; delivered/manual retry requires Super Admin and evidence.
2. Implement shared send boundary, new guarded RPC protocol, bounded acknowledgement retry and service-only evidence recovery. Extend canonical migration inventory and existing tests.
3. Run focused tests and disposable Postgres with actual concurrent claims. One bounded luna_worker privacy/permission final review; only one focused repair re-review if required. Then run lint, TypeScript, full tests, localization and production build.
4. Update PR49 scope on the same branch; push and wait CI. Merge with a normal merge preserving protected cd8455b8 history; retain branch. Wait main CI.
5. Re-read production migration state, apply only the new reviewed forward recovery migration. Inspect safe queue aggregates first. Verify installed function ACLs/behavior without sending unrelated mail; do not reset existing sent rows.
6. Deploy the merged exact source through authorized Hostinger controls. If the direct login is unavailable, preserve ready release and state the actual permission blocker. Confirm exact deployed head and build/restart success plus public route behavior.
7. Inspect configured authenticated mail, expiry and event-refund jobs; preserve existing schedules. Verify scheduler execution against durable job records, not merely configuration. New exception email uses only synthetic content and the designated test mailbox; inspect actual inbox and public Vendor link. Do not manufacture financial actions or customer orders as proof.

## Risks and verification evidence

The lease is an operational timeout, not a business deadline. SMTP cannot guarantee exactly-once delivery; ambiguous attempts remain visible for evidence-based recovery. Message-ID is audit correlation only. Lost database acknowledgement leaves a recoverable/quarantined record, never a blind retry. Failed delivery preserves existing financial outcomes and App notifications. Operator tooling does not print email payloads/recipients/secrets.

Both current PR CI and protected ancestry were verified before this repair. Final repair verification and actual rollout outcomes will be recorded here and in the external release backup. Existing global/projection privacy rules and all unrelated KYC/Reward/Affiliate/Withdrawal authorization remain unchanged.

## Verification and operating procedure — 2026-10-14

Final code: 5,061 Vitest tests passed / 42 skipped (1,093 files passed / 12 skipped). Lint 0 errors / 93 warnings; TypeScript, localization and CI-placeholder production build passed. The final SQL-only repair was separately verified against real loopback PostgreSQL and will also run through the new head CI. No SMTP/DB secret or real customer payload was printed by test tooling.

One final luna_worker review found a confirmed legacy KYC monitor NULL-token retry gap. Added conservative quarantine for failed legacy attempts without tokens; new protocol retries retain tokens. The isolated copied migration with the clause removed fails the new monitor-first regression (RED), while the real migration passes (GREEN). The single focused repair re-review reports no remaining blocker. Other speculative work was not expanded.

Additional exact files: `lib/email/__tests__/smtp-delivery.test.ts`; `scripts/run-event-cron.mjs`; `app/api/cron/process-email-outbox/__tests__/route.test.ts`; existing recommendation/vendor mail tests updated only for the guarded RPC contract. The Node Cron runner accepts only `expire`/`refunds`, reads the existing secret from Hostinger server env, rejects redirects/non-HTTPS origins and emits counts only.

Operator recovery: run `npm run email:delivery` with the existing service environment to inspect attention cases. Its JSON contains protected attempt tokens, so view it in a private terminal and do not put it in ordinary logs. Search the sender's Sent copy/provider records and intended recipient using the stable Message-ID. A delivery result must be explicitly verified; absence from a recipient inbox alone does not prove SMTP never accepted it. Use the script's `--resolve` mode only with `EMAIL_DELIVERY_RECOVERY_WRITE=1`, the current id/token/updated-at from inspection, an authorized Super Admin actor, decision `delivered` plus verified message ID or `retry` after evidence of non-delivery, and a private 20–500-character evidence file. SQL enforces actor, evidence and current version, then audits the decision. Do not clear unknown rows or reset them in bulk.

SMTP outcome classification follows the installed Nodemailer API and official [error reference](https://nodemailer.com/errors) and [SMTP transport](https://nodemailer.com/smtp). ECONNECTION/EMESSAGE alone do not prove non-acceptance after DATA. Stable Message-ID correlates attempts but is not a provider idempotency guarantee.

Production read-only preflight: 213 existing email rows are sent; no queued/sending/failed rows were returned. No event operational job run rows were returned. Hostinger currently shows main@a4247c40 and only existing mail (every 5 minutes) / KYC jobs; deployment controls are disabled in collaborator impersonation mode. No new migration, scheduler, email or financial action has yet been executed in production. Designated inbox identity matched the explicitly supplied test address; targeted acceptance search is prepared.
