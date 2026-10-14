# Event fulfilment, refund review and reconciliation application integration

Status: Application integration implemented and locally verified on feature/event-part. Push/PR CI is the remaining source-integration release check; production deployment and live acceptance remain separate.

## Context and decisions

Keep the prepared primary checkout and feature/event-part. Extend draft PR49 after notification commit 4e14ffba. Integrate only previously approved, implemented old-worktree application changes; existing database migrations are already installed and archived byte-for-byte in PR49. No new product design or database migration is required. Preserve the source worktree and all latest main/PR48/PR49 changes.

In scope: safe payment-exception UI, closed checkout rejection; structured refund reasons, authoritative pickup evidence and versioned approval; event stock/slot errors and explicit date/listing shortage preview-confirm; separate financial/exception filters and pagination; Super Admin claim/deadline/no-show/closure controls; durable existing-job run records. Record source, PR, deployment and real-world acceptance separately.

Not in scope: overnight/24h operation, partial pickup/refunds, waitlists, paid stalls, multiple stalls or a new portal; generic Button changes, KYC/auth/Reward/Affiliate/Withdrawal rules. Real payments, refunds, settlements, claims and emails are not test actions. Deployment preparation and read-only environment checks can proceed; no live financial action is authorized by an implementation request.

## Reuse Decisions

- Extend existing app/admin/reports/reconciliation/page.tsx and lib/admin/reconciliation.ts, using old-worktree implementations. No duplicate report/page.
- Reuse components/admin/staff-conduct-panel.tsx as the full financial-list behavior reference and components/admin/staff-conduct-filtering.ts#paginateStaffConductRecords: default15/options25/50, filter-first count, page reset for search/status/net/month/page-size, clamped pages and previous/next. Cards, warnings and CSV cover all matching loaded records, not the current page. Preserve the explicit loaded-data scope; do not call the bounded source complete monthly data.
- Reuse the approved existing service-side exception filter contract in lib/admin/event-operations-filters.ts and get_event_reservation_operations_filtered: combined search/kind/handling/owner/deadline, fixed25 per page, filter changes reset page1, matching total and global summary remain distinct. Fixed25 comes from the attached approved existing implementation, not a new generic default.
- Reuse components/admin/filter-bar.tsx, components/providers/app-dialog.tsx, components/ui/{button,input,textarea}.tsx and current tokens. No new shared UI component. Extend the filter surface inventory with reconciliation while retaining promotion-campaigns and newer KYC contracts.
- Extend existing Admin refund API/page and lib/refunds/process-refund.ts with already-installed claim/assert evidence and funding snapshot RPCs. Preserve current manual-reference requirement, simulator environment guards, provider idempotency, amount/currency checks and Guest access.
- Extend components/customer/refund-request-dialog.tsx and existing order refund routes with stable optional reason codes; legacy text-only requests remain valid. Refuse spoofed identities/fulfilment evidence.
- Reuse existing event listing edit validation, authenticated organiser shortage RPC and cancellation/refund processor. Reject financial-outcome/fraud endpoints because shortage is not fraud.
- Reuse the two current authenticated Cron routes and donor lib/events/operational-job.ts shared by both. No new schedule; database run records must distinguish never-run/running/failed/stale/succeeded, and provider acceptance is not completion.
- Reuse all seven already-deployed canonical migrations and loopback SQL fixtures from PR49 unchanged. Reject copying donor historical migration names or rerunning them; versions and hashes were verified in the notification plan.
- Merge only eventOperations and reconciliation.filters in EN/MS/zh-CN admin.json. Reject whole-catalog copies because donor lacks newer main and PR48 translations.

**Reuse audit complete.**

## Exact files, functions and phases

Existing files to extend:
- `app/admin/orders/page.tsx`
- `app/admin/refunds/page.tsx`
- `app/admin/reports/reconciliation/page.tsx`
- `app/admin/__tests__/filter-consistency.contract.test.ts`
- `app/api/admin/orders/route.ts`
- `app/api/admin/reconciliation/route.ts`
- `app/api/admin/reconciliation/__tests__/route.test.ts`
- `app/api/admin/refunds/[refundId]/route.ts`
- `app/api/admin/refunds/[refundId]/__tests__/simulator-route.test.ts`
- `app/api/admin/refunds/route.ts`
- `app/api/admin/refunds/__tests__/route.test.ts`
- `app/api/cron/expire-checkout-sessions/route.ts`
- `app/api/cron/expire-checkout-sessions/__tests__/route.test.ts`
- `app/api/cron/process-event-refunds/route.ts`
- `app/api/cron/process-event-refunds/__tests__/route.test.ts`
- `app/api/orders/[orderId]/refund/route.ts`
- `app/api/vendors/[vendorId]/campaign-listings/[listingId]/route.ts`
- `app/customer/checkout/page.tsx`
- `app/customer/orders/[id]/page.tsx`
- `components/customer/refund-request-dialog.tsx`
- `lib/admin/reconciliation.ts`
- `lib/admin/__tests__/reconciliation.test.ts`
- `lib/checkout/start-payment.ts`
- `lib/refunds/process-queued-event-refunds.ts`
- `lib/refunds/process-refund.ts`
- `lib/refunds/__tests__/process-refund.test.ts`
- `lib/vendor/campaign-registrations.ts`
- `app/i18n/locales/en/admin.json`
- `app/i18n/locales/ms/admin.json`
- `app/i18n/locales/zh-CN/admin.json`

Existing donor modules/routes/tests to integrate as new paths:
- `app/admin/reports/reconciliation/__tests__/page.test.tsx`
- `app/api/admin/orders/event-shortage/route.ts`
- `app/api/admin/orders/event-shortage/__tests__/route.test.ts`
- `app/api/admin/reconciliation/event-exceptions/[caseId]/route.ts`
- `app/api/admin/reconciliation/event-exceptions/[caseId]/__tests__/route.test.ts`
- `lib/admin/event-operations-filters.ts`
- `lib/admin/reconciliation-filtering.ts`
- `lib/admin/__tests__/event-operations.test.ts`
- `lib/admin/__tests__/event-operations-filters.test.ts`
- `lib/events/operational-job.ts`
- `lib/events/__tests__/operational-job.test.ts`

Affected interfaces: reconciliation load/filter/page/CSV/claim/no-show handlers; getOrderMoneyReconciliation/getEventReservationOperations; refund GET/POST and processRefund; shortage POST; event listing error mapping; checkout start and return handler; both Cron GETs and runEventOperationalJob. No new dependency/schema.

1. Back up exact target/source, then import tests first. Reproduce missing reconciliation pagination/claim behavior and missing refund evidence assertion before code integration.
2. Apply scoped donor patches with three-way reconciliation; preserve current Guest/KYC/payment security and existing notification cron tests. Merge affected catalog subtrees only. Integrate domain helper/API tests in place.
3. Run affected Vitest, real disposable PostgreSQL and browser fixture acceptance using actual page/shared components with in-memory APIs. Never create a live shortage/claim/refund to test.
4. One bounded independent luna_worker final permission/funding/privacy review. Repair confirmed must-fix only; maximum one focused re-review. Run lint, TypeScript, i18n, full suite and production build once after final change.
5. Commit/push on the same prepared branch and update PR49 title/body around the complete final scope. Wait for GitHub CI. A successful merge/deploy/real inbox acceptance must have its own evidence; do not label the full live journey accepted from synthetic tests.

## Acceptance and risks

- All financial table filters/options/counts/reset/clamp and complete matching CSV/cards must be tested. Exception filters run server-side, preserve fixed25 and clear distinction between matching/global obligations. Failed/stale report disables export; failed actions retain loaded records.
- Claim requires future valid Malaysia deadline; empty/past/invalid/cleared values disable the button and handler. Actor/version/ownership are resolved and rechecked server-side. No-show requires explicit explanation and authoritative DB evidence; expiry alone makes no final disposition.
- Refund stale evidence must stop any provider call; legitimate collected-goods refund requires explanation, not blanket rejection. Processed/pending/attention counts and notifications must be truthful. Ordinary shop, original wallet buckets and Guest binding remain intact.
- Safe shortage changes only selected listing/date and eligible uncollected lines; stale preview fails. Existing backend tests remain controlling.
- Preserve current error sanitization and auth access. Raw customer contacts, provider errors, internal paths and reviewer notes cannot enter Vendor/Public projections.
- Existing production mail sending lease/ambiguous delivery and live provider recovery remain separate known reliability work unless a confirmed blocking regression is found. Do not expand into those mechanisms during this bounded integration.
- Verify source fingerprints, protected history cd8455b8 and current main, and a clean working tree at handoff. No branch switching, new worktree, force push or history rewrite.

Backup: `/Users/tanzhengyang/.codex/backups/mywisata/event-flow-integration-20261014-184338`.

## Focused integration repair

The old no-mutation Admin Orders contract conflicts with the explicitly approved shortage action. Updated the contract to permit exactly the preview/confirm POSTs to the scoped shortage route, requiring confirmation and version retention; unrelated mutation routes remain forbidden.

Independent review found an existing privacy defect in the touched general refund-notice producer. Extend the existing lib/checkout/order-access.ts projections with display_id while retaining every original ownership filter. A route-local label sanitizer in the existing refund route removes UUIDs and uses a safe fallback; fixed Vendor orders link, readable reference and scoped Vendor name replace raw order IDs and customer free text. Vendor event identity includes the Vendor so a common owner cannot collapse unrelated businesses; identical Vendor/outlet lines are deduplicated, owners with no outlet receive the notice, and enqueue is awaited best-effort. Reuse existing emit/scope/outbox; no new emitter or permission. New regression tests reproduced the unsafe projection, then passed together with Guest identity tests. Review is restricted to one focused repair re-review.

Additional exact files: lib/checkout/order-access.ts; app/api/orders/[orderId]/refund/__tests__/guest.test.ts; app/api/orders/[orderId]/refund/__tests__/route.test.ts; app/admin/orders/__tests__/page.contract.test.ts; lib/refunds/__tests__/process-queued-event-refunds.test.ts. The last tests distinguish provider-pending from processed and unknown results handed to Admin.

## Final verification record — 2026-10-14

- Full application suite: 1,090 files passed / 12 skipped; 5,040 tests passed / 42 skipped. The old Admin Orders no-mutation assertion was updated only for the explicitly approved versioned shortage preview/confirm contract.
- Lint: 0 errors / 93 warnings. TypeScript and CI-placeholder production build passed. EN/MS/zh-CN localization complete.
- Real disposable PostgreSQL event suite passed using the already archived canonical migrations: payment/stock/slot commitment, cancellation/refund evidence, shortage scoping, query filters, pickup/no-show/settlement, Vendor notice scope/deduplication and concurrent sessions. No production SQL or job invocation. Temporary database stopped after acceptance.
- Actual reconciliation page/shared components browser acceptance used synthetic in-memory APIs: financial 15/25/50 paging and filtered totals, filter resets, claim deadline and conflict retention, explicit no-show explanation/confirmation, and fixed 25-per-page exception paging. Screenshots retained under `/Users/tanzhengyang/.codex/visualizations/2026/10/14/event-flow-check/`. This is not production acceptance.
- One bounded luna_worker final review identified the general-refund Vendor projection privacy issue; regression tests failed first, then passed after the narrow repair. The single focused repair re-review passed. No further review loop.
- All 41 recorded donor source fingerprints remain unchanged. Primary checkout remains feature/event-part. The old worktree is preserved.
- GitHub CI/head, merge-preview tree and historical ancestry evidence will be recorded in PR49 and the external backup manifest after push. No migration replay, live claim/shortage/refund/settlement, email send or production deployment occurred.

Remaining operational acceptance: merge and deploy the reviewed source; verify Hostinger expiry/refund schedules and job records; use an explicitly designated test mailbox/order for new exception-email inbox acceptance and the latest live journey. Existing mail sending-lease/ambiguous-result recovery remains follow-up work. Cross-night, partial fulfilment/refunds, waitlists and expanded stall models remain outside this approved integration.
