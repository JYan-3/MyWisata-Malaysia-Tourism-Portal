# Vendor exception notice integration

Status: Implemented and locally verified; release/inbox acceptance remains separate. User requested completion of the described Vendor App and Email notices.

## Context and decisions

Keep feature/event-part in the selected primary checkout. PR48 changed only the activity workbench. Read-only FYP verification found all seven old-worktree backend migrations already installed, both deferred notice triggers enabled, four App notices and four email_outbox rows marked sent. This is not inbox receipt evidence. Never replay these migrations or invoke production discovery, email processing, refunds, claims or settlement during this task. Preserve the old worktree unchanged.

Existing approved business design: seven phases payment_blocked, pickup_review, refund_pending, refund_attention, refunded, collected, no_show. Only the affected Vendor owner receives financial phases; exact assigned outlet managers may receive operational pickup phases. Same phase is deduplicated; assignment/deadline changes are silent. Vendor evidence does not authorize financial approval.

## Reuse Decisions

- Reuse the existing deployed notification SQL and its forward prerequisites exactly; use installed versions as canonical filenames and preserve the source-to-installed mapping below. Reject a parallel JS emitter because it would lose transactional atomicity and duplicate a deployed writer.
- Reuse lib/vendor-notifications/scope.ts rules, existing notifications API/bell and durable email_outbox processor. No new table, public API, component, email type, permission or npm dependency.
- Extend lib/email/outbox.ts and lib/email/templates.ts with allowlisted Vendor orders/wallet links; merge only notification-specific template hunks, retaining current KYC and Guest logic.
- Extend lib/notifications/localize.ts and only notifications.events.eventException in EN/MS/zh-CN common.json, preserving current catalogs.
- Extend the existing expiry cron with refresh_overdue_event_pickups after successful expiry. Preserve authentication and existing error responses; surface discovery failure explicitly. Do not add a separate job runner or scheduler.
- Extend existing Stripe finalization/confirmation/webhook success guards so payment_exception never emits a normal fulfilment-ready order/email. Retain Guest authorization and all provider checks.
- Reuse scripts/test-event-management-db.mjs and its exact loopback-only fixture contracts to verify actual SQL transactions, scoping, dedupe, final state, blank email and ACLs.
- Reject importing the donor Admin pages, shortage endpoints, Button, checkout redesign or unrelated catalog changes: none is required for the notification connection. No list-page UI is modified.

**Reuse audit complete.**

## Exact files and functions

Application/tests and existing runner/inventory:
- `app/api/checkout/__tests__/external-finalize-guard.test.ts`
- `lib/email/outbox.ts`
- `lib/email/templates.ts`
- `lib/email/__tests__/event-outbox.test.ts`
- `lib/email/__tests__/templates.test.ts`
- `lib/notifications/localize.ts`
- `lib/notifications/__tests__/localize.test.ts`
- `scripts/test-event-management-db.mjs`
- `supabase/migrations/__tests__/canonical-history.test.ts`
- `app/api/cron/expire-checkout-sessions/route.ts`
- `app/api/cron/expire-checkout-sessions/__tests__/route.test.ts`
- `app/api/checkout/confirm-stripe/route.ts`
- `app/api/checkout/confirm-stripe/__tests__/route.test.ts`
- `app/api/checkout/finalize/route.ts`
- `app/api/stripe/webhook/route.ts`
- `app/api/stripe/__tests__/webhook-order-settlement.test.ts`
- `app/i18n/locales/en/common.json`
- `app/i18n/locales/ms/common.json`
- `app/i18n/locales/zh-CN/common.json`

Preserve the already-applied SQL and disposable SQL tests:
- `supabase/migrations/20261011171225_event_checkout_commitment_guards.sql`
- `supabase/migrations/20261011171233_event_reservation_change_guards.sql`
- `supabase/migrations/20261011171242_event_refund_review_evidence.sql`
- `supabase/migrations/20261011171247_event_reservation_operations.sql`
- `supabase/migrations/20261011171300_event_exception_query_filters.sql`
- `supabase/migrations/20261011194020_event_settlement_pickup_resolution.sql`
- `supabase/migrations/20261012013400_event_exception_vendor_notices.sql`
- `supabase/tests/event_checkout_baseline.sql`
- `supabase/tests/event_checkout_commitments.sql`
- `supabase/tests/event_checkout_finance_fixture.sql`
- `supabase/tests/event_exception_query_filters.sql`
- `supabase/tests/event_exception_vendor_notices.sql`
- `supabase/tests/event_refund_review_evidence.sql`
- `supabase/tests/event_reservation_edit_guards.sql`
- `supabase/tests/event_reservation_operations.sql`
- `supabase/tests/event_settlement_pickup_resolution.sql`
- `supabase/tests/event_shortage_resolution.sql`

Affected functions: localizeNotification, renderVendorEmail, processEmailOutbox, expiry GET, Stripe confirmation POST, finalization POST, Stripe order settlement webhook guards. SQL copies preserve their already-deployed functions unchanged.

## Local / remote migration identity

Do not interpret timestamp differences as unapplied migrations. Validate name and source digest before any future rollout.

| Original worktree version | Installed and canonical version |
| --- | --- |
| 20261008192801 | 20261011171225 |
| 20261008192802 | 20261011171233 |
| 20261008192803 | 20261011171242 |
| 20261008192804 | 20261011171247 |
| 20261008213739 | 20261011171300 |
| 20261011192338 | 20261011194020 |
| 20261012012513 | 20261012013400 |

## Phases and verification

1. Back up exact source/target files and rollout evidence. Import affected tests first and reproduce missing localized phase/action link, missing overdue discovery and false paid-order notification.
2. Integrate only the corresponding code hunks, catalogs and exact deployed SQL. Update canonical migration inventory without removing newer main migrations.
3. Run focused Vitest and real disposable loopback PostgreSQL tests. Do not connect the test runner to production. One bounded independent permission/privacy final review; repair confirmed blockers only, one focused re-review maximum.
4. Run lint, TypeScript, localization, full tests and production build with safe placeholders. Record test counts, limitations and unchanged source fingerprints. Prepare a commit on feature/event-part; remote application rollout and real inbox acceptance remain separate.

## Boundaries and risks

No live DB mutation, email send, new migration application, refund/payout/claim/settlement action or branch/worktree change. Do not modify KYC, Reward/Affiliate, Withdrawal or registered-user Email verification rules. Do not overwrite new main migration/catalog/security additions. New backend sources are archived for reproducibility, not a new authorization to change money behavior. Existing production Cron scheduling must be verified separately; source integration cannot prove a scheduled run or inbox delivery.

Backup: `/Users/tanzhengyang/.codex/backups/mywisata/vendor-exception-notices-20261014-152328`.

## Verification record — 2026-10-14

- Imported tests first: 14 failed / 26 passed on the old application; wallet finalization separately reproduced one false-notification failure. Focused fixes passed.
- Full application suite: 1,083 files passed / 12 skipped; 5,003 tests passed / 42 skipped. TypeScript, localization EN/MS/zh-CN and production build with CI placeholder environment passed. Lint: 0 errors, 93 existing warnings.
- Actual PostgreSQL 17.10 in an isolated temporary loopback cluster: baseline without notice migration failed with missing scoped notices; patched suite passed Vendor/outlet/owner isolation, financial-manager exclusion, null-outlet owner, seven phases, stable event-key dedupe, assignment/deadline silence, pending/failure/processed truth, final-state-only notices, blank-email preservation and private ACLs. Existing checkout/refund/pickup/settlement two-session races passed.
- Test runner fixtures were adjusted to tomorrow instead of today, so the fixed pickup slots remain valid after their closing time. A verified-collected transition assertion was added; it proves one App/email final outcome and no stale pickup reminder. No production SQL source changed.
- Read-only FYP migration statement SHA-256 values match all seven archived SQL files byte-for-byte; canonical filenames now match installed versions. No migration repair, replay, production data write, claim, refund, settlement, scheduler invocation or email send was performed.
- One bounded luna_worker final review found no confirmed must-fix. An initially suspected duplicate case was disproved by checking the insert/link/NOT EXISTS order; no speculative repair was made.
- Original old-worktree source fingerprints are unchanged. No Admin page/list UI, auth/KYC/Reward/Affiliate/Withdrawal or dependency changes were imported.
- Production evidence at inspection: two deferred notification triggers enabled, four scoped App notices, four emails marked sent. Inbox delivery and production scheduling were not newly certified.
- The complete old-worktree Admin exception/claim/deadline/refund-review screens remain a separate integration item. This notification change connects the already-installed service-only discovery to the existing authenticated expiry cron.
- Existing email `sending` lease recovery and ambiguous network delivery are follow-up reliability work; this integration retains current retry behavior and does not claim exactly-once SMTP delivery.
- Full canonical migration replay is not claimed; the existing runner uses bounded real migration/finance fixtures. Tests do not certify live financial outcomes.
