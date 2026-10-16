# Commerce Risk and Guest Maintenance

**Status:** Database migrations deployed and verified on linked FYP (`ncdlaehknicabzjqskvk`) on 2026-10-16. Hostinger target confirmed as `https://mylawatan.my`, hPanel Node.js Web App / Next.js / Node 22.x. User clarified that application publication proceeds through commit and PR merge to source main, automatic teacher-main synchronization, and automatic hosting deployment. Source delivery is in progress; the new hourly Hostinger job requires a one-time hosting-operator configuration. Gateway-specific unknown-create recovery remains deferred until the teacher confirms the provider.
**Created:** 2026-10-16 10:16 Asia/Kuala_Lumpur
**Workspace / branch:** `/Users/tanzhengyang/Documents/GitHub/MyWisata-Malaysia-Tourism-Portal` / `feature/event-part`

## Context

The original purchase requirements conflict with later confirmed policy. The current repository already supports Guest purchases and Email-verified registered purchases. The same review identified three further concerns: measuring post-release refund/dispute exposure before deciding whether to hold additional funds, preserving safe payment settlement/reconciliation across the eventual gateway choice, and preventing expired guest rate-limit keys from accumulating indefinitely.

This work excludes OCR. The user chose an exposure report without freezing balances. It does not invent a reserve percentage or payout holdback. The final payment gateway (SenangPay or ToyyibPay) is awaiting the teacher's confirmation; gateway-specific recovery work stays deferred until selected.

## Decisions and scope boundaries

- Keep the current product rule: Guest may purchase; a registered customer needs verified Email; Phone/Profile/KYC are not checkout prerequisites. Do not modify its runtime authorization unless verification uncovers a regression.
- Mark superseded phone-gated checkout documents as historical for purchase access, while preserving their still-valid phone verification requirements for other capabilities.
- Delete guest rate-limit rows only when their fixed-window start is older than 24 hours, the longest interval accepted by `reserve_guest_rate_limit`. Process a bounded batch through an authenticated service-only scheduled route. This changes no active rate-limit decision.
- Extend the existing monthly payout report with observed vendor settlement shortfalls. Do not move or freeze wallet funds, change the commission hold window, or show a reserve recommendation as approved policy.
- Chargeback/fraud status changes must invoke the existing vendor-settlement reversal, which records an actual clawback shortfall when the wallet cannot cover it. Report only the source data the ledger can prove; current `settlement_clawback_shortfalls` is vendor-settlement evidence, not a complete affiliate or platform-cash exposure model.
- Preserve the existing normalized payment settlement contract and ToyyibPay callback/reconciliation implementation. Add or change a provider adapter only after the target gateway and its callback/query capabilities are confirmed.
- The user's subsequent execution instruction authorizes applying the two prepared migrations to the verified linked FYP database. No live payment, refund, payout, or historical order-status operation is required. Application deployment now targets Hostinger once the exact site and hosting type are confirmed.

## Reuse Audit and Reuse Decisions

| Candidate | Exact path | Decision | Reusable behavior / reason |
|---|---|---|---|
| Current purchase entitlement | `lib/entitlements/evaluator.ts`, `app/api/checkout/prepare/route.ts`, and `Docs/plans/2026-10-02-0046-guest-and-email-verified-purchases.md` | Reuse | Current code and approved plan already express Guest and Email-only purchase. Avoid duplicate gates or new verification tiers. |
| Historical phone-gated guidance | `Docs/adr/025-tier-ladder-and-promotion.md`, `Docs/adr/026-phone-verification.md`, `Docs/adr/028-tier-gate-enforcement.md`, `Docs/research/2026-08-29-progressive-verification-access-contracts.md`, `Docs/research/2026-08-29-independent-verification-capability-models.md` | Extend | Add a concise supersession notice scoped to commerce purchase/checkout; retain the rest of the historical phone-verification decisions. |
| Existing payout report | `app/admin/reports/payouts/page.tsx`, `app/api/admin/reports/payouts/route.ts`, `supabase/migrations/20261004083124_private_generate_monthly_payout_report.sql` | Extend | Reuse its Super Admin authorization, monthly snapshot, existing wallet balance metrics and UI. Do not create a second finance report page. Add observed vendor clawback shortfalls and explicitly label coverage. |
| Existing payment settlement | `lib/payments/provider-contract.ts`, `lib/payments/providers.ts`, `app/api/payments/toyyibpay/callback/route.ts`, `app/api/cron/reconcile-toyyibpay-checkouts/route.ts`, `supabase/migrations/20260905075000_toyyibpay_checkout.sql` | Reuse / extend after gateway decision | Reuse normalized provider outcome, amount/currency validation, event dedupe and reconciliation. No Stripe-specific work and no assumed SenangPay behavior. |
| Existing guest limit reservation | `lib/checkout/guest-session.ts`, `supabase/migrations/20261002004601_guest_checkout_ownership.sql` | Extend | Keep the atomic single-key upsert. Add bounded expired-key cleanup; do not use non-atomic `lib/rate-limit/db.ts` for checkout abuse limits. |
| Existing vendor clawback | `supabase/migrations/20260911000000_vendor_order_settlement.sql#reverse_order_vendor_settlement`; `supabase/migrations/20261002145304_close_order_financial_lifecycle.sql#sync_paid_order_vendor_settlement` | Extend | Reuse the atomic, wallet-locked reversal and shortfall ledger. The installed status trigger currently handles `refunded`, so extend it to `chargeback` and `fraud` too. |
| Existing scheduled maintenance | `app/api/cron/archive-chats/route.ts`, `vercel.json`, `scripts/run-event-cron.mjs` | Reuse / extend | Reuse the CRON_SECRET endpoint and the existing Hostinger runner's HTTPS origin validation, timeout, fixed error and count-only logging. Add one allowed guest-limit task. Vercel's schedule does not activate a Hostinger job; document the one-time operator setup in `README.md`. |
| Existing source delivery | `.github/workflows/sync-teacher-main.yml` | Reuse unchanged | It fast-forwards teacher main from source main every 15 minutes and refuses workflow-file changes or divergent history. Keep workflow files unchanged and deliver through a normal PR merge. |

**Reuse audit complete.**

## Phases and files

### Phase 1 — settle current policy documentation

- Modify `Docs/adr/025-tier-ladder-and-promotion.md`, `Docs/adr/026-phone-verification.md`, `Docs/adr/028-tier-gate-enforcement.md`, `Docs/research/2026-08-29-progressive-verification-access-contracts.md`, and `Docs/research/2026-08-29-independent-verification-capability-models.md` with a purchase-scoped supersession note linking to the current Guest/Email purchase plan.
- Do not edit historical migrations or alter non-purchase phone-verification rules.

### Phase 2 — close chargeback clawback gap and expose measured reserve signals

- Add `supabase/migrations/20261016022142_commerce_risk_exposure.sql`, extending the existing order status trigger so `refunded`, `chargeback`, and `fraud` outcomes invoke the idempotent vendor settlement reversal, and adding vendor shortfall metrics to the private payout report.
- Add translated labels/help copy in `app/i18n/locales/{en,ms,zh-CN}/admin.json`; extend `app/admin/reports/payouts/page.tsx` and its contract test.
- Do not claim the vendor-only shortfall view is a complete estimate of affiliate or platform cash loss; do not automatically calculate or retain a reserve.

### Phase 3 — clean expired Guest rate-limit keys

- Add `supabase/migrations/20261016021843_guest_rate_limit_cleanup.sql`, generated with the repository's Supabase CLI. It adds an index on `guest_rate_limits.window_started_at` and a bounded purge function whose execution is revoked from `PUBLIC`, `anon`, and `authenticated` and granted only to `service_role`.
- Add `app/api/cron/purge-guest-rate-limits/route.ts` and its route tests, reusing the established cron authentication/logging pattern.
- Register an hourly bounded schedule in `vercel.json`, preserving existing uncommitted changes.
- Extend `scripts/run-event-cron.mjs` with the allowed `guest-rate-limits` task and document the hourly Hostinger command in `README.md`. No new scheduler service or dependency. The teacher/hosting operator retains the external job configuration.
- Add migration contract tests for 24-hour expiry, batch bound, index, and function grants.

### Phase 4 — gateway conformance (conditional on provider selection)

- After the target is confirmed, inspect the selected gateway's current primary documentation and close the unknown provider-create outcome recovery gap by extending the existing provider contract/adapter and settlement/reconciliation tests.
- Preserve the common database settlement invariants. Do not build a speculative adapter for both providers.

## Exact implementation file inventory

- Migrations: `supabase/migrations/20261016021843_guest_rate_limit_cleanup.sql`, `supabase/migrations/20261016022142_commerce_risk_exposure.sql`, and their migration contract tests; `supabase/migrations/__tests__/canonical-history.test.ts` records both approved forward migrations.
- Guest maintenance: `app/api/cron/purge-guest-rate-limits/route.ts`, its route test, `vercel.json`, `scripts/run-event-cron.mjs`, and the Hostinger readiness note in `README.md`.
- Risk report: `app/admin/reports/payouts/page.tsx`, `app/admin/reports/payouts/__tests__/page.contract.test.ts`, and `app/i18n/locales/{en,ms,zh-CN}/admin.json`.
- Historical purchase policy: the five ADR/research files named in Phase 1.
- No API route changes are needed: the existing Super Admin-authorized payout endpoint already returns the summary JSON from the private report RPC.

## Files not being touched

- OCR/KYC implementation and deployment.
- Wallet balances, ledger, payout amounts, reserve percentages, withdrawal approval policy, or hold windows.
- Current checkout authorization logic unless an actual regression is found.
- Unrelated dirty files in the user's workspace.
- Live payment-provider configuration or credentials. The two named database migrations and the requested Hostinger release are the only rollout scope.

## New dependencies and database changes

- No new package dependency.
- Phase 2 adds no wallet-balance mutation beyond the existing vendor clawback path, which now also runs for chargeback/fraud. It adds report fields and reuses the existing settlement reversal ledger.
- Phase 3 adds only an index and a service-role-only bounded cleanup RPC. Cleanup is outside the request path.
- Phase 4 depends on the confirmed provider and may require provider-specific schema fields only if the existing generic payment records cannot represent its references/statuses.

## Risks

- A cleanup retention shorter than a caller's active rate window could reset a live limit. Use the existing maximum accepted window (24 hours) as the cutoff and test the boundary.
- The current shortfall table measures vendor settlement clawbacks only and has no resolution workflow; show created and unresolved totals, and do not label them platform loss or total reserve need.
- Payment integration cannot be finalized while the target gateway is unknown. Existing ToyyibPay protections remain in place.
- ToyyibPay create outcomes that are indeterminate after provider bill creation still lack a recovery query path; implementing this safely depends on the selected provider's idempotency/query features.
- Supersession notes must be scoped to purchase/checkout and must not erase phone-verification rules for unrelated capabilities.

## Verification

- Focused route/report/migration tests: 11 passed across 5 files. `npx tsc --noEmit` passed. `npm run lint -- --no-warn-ignored` passed with existing warnings and no errors. `git diff --check` passed.
- `npm run verify:i18n` passed coverage and default-value checks, then stopped on 80 existing punctuation-concatenation lint warnings across the repository; no missing translation keys were reported for the added fields.
- Review the generated migration for RLS/grants, bounded delete behavior, concurrency safety, and replay/idempotency before considering deployment.
- Do not claim production capacity, reserve adequacy, gateway readiness, or remote migration success from local tests.
- Complete one focused `luna_worker` read-only review of cleanup permissions/races and gateway settlement boundaries before handoff.

## 2026-10-16 authorized database execution

- Verified linked project `ncdlaehknicabzjqskvk` is the active FYP project. Read the installed trigger, reversal, private report function, migration history, and indexes before application; independent `luna_worker` preflight found no confirmed blocker.
- Applied only `20261016021843_guest_rate_limit_cleanup.sql` and `20261016022142_commerce_risk_exposure.sql` through Supabase migration application. Other pending files were excluded.
- Supabase initially recorded application timestamps `20261016023212` and `20261016023222`. Confirmed both stored SQL statements matched the corresponding local source byte-for-byte, then transactionally aligned only these two newly created history versions to the existing local CLI-generated versions (`20261016021843`, `20261016022142`), with exact source equality and target-absence guards. SQL bodies and local filenames were preserved.
- Installed contracts verified: all three new indexes exist; `anon` and `authenticated` cannot execute either purge or report RPC; `service_role` can. Trigger includes chargeback/fraud and the report contains all four new vendor shortfall metrics.
- Ran actual service-role SQL verification in a rolled-back transaction: explicit NULL, zero, negative, and oversized batches are rejected; batch size one deletes one expired fixture while preserving the active fixture; the report RPC executes successfully and its open-shortfall amount matches the ledger. Temporary keys and report writes were rolled back.
- Executed one bounded real purge. Guest limit rows changed from 24 total / 7 expired to 17 total / 0 expired; all 17 active records remained.
- Security advisor findings are unchanged from the captured preflight (19 INFO and 8 existing WARN findings), with no new security finding. Existing service-only Guest tables intentionally have no client RLS policies. The performance advisor still notes existing uncovered shortfall foreign keys; this rollout adds indexes for the report's timestamp and unresolved-amount scans. See [Supabase foreign-key index guidance](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys).
- No live order was changed to exercise a chargeback/refund, and no real payout, wallet transfer, or payment-provider request was performed.

## Hostinger application rollout — Git delivery

- User requested publication and identified Hostinger as the platform, then asked what publication does. Explained that application publication exposes the report UI and enables scheduled background cleanup.
- Read-only hPanel investigation confirmed `mylawatan.my`, a managed Node.js Web App running Next.js on Node 22.x. At inspection the current deployed revision was source `main@61bf8346`.
- User clarified that manual Redeploy controls belong to the teacher. Commit only this task's source changes on `feature/event-part`, open a PR to the source repository's `main`, and merge after the existing CI verifies the exact release. Preserve unrelated dirty/intent-to-add OCR, translation, and trip work in the shared checkout.
- Reuse `.github/workflows/sync-teacher-main.yml` unchanged for teacher synchronization. Inspect source and teacher head/CI status before reporting automatic delivery; do not claim hosting success without observing the deployed revision.
- Extend the existing `scripts/run-event-cron.mjs` task allowlist. `vercel.json` alone does not schedule jobs on Hostinger, and application redeployment does not create a new hourly job. Hosting operator setup: run `node scripts/run-event-cron.mjs guest-rate-limits` from the application root, with existing app environment and schedule `0 * * * *`, then verify aggregate output. Keep all credentials in server environment variables.
- Official deployment references: [Hostinger Node.js deployment](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/), [Hostinger cron jobs](https://www.hostinger.com/support/1583465-how-to-set-up-a-cron-job-at-hostinger/).

## Scoped source release verification

- Prepared a disposable build snapshot from the selected branch HEAD plus only the 21 task files staged for this release. Shared locale JSONs contain only payout additions; migration inventory contains only the two already-applied task migrations; unrelated pending content/OCR/trip work is excluded.
- Seven focused test files / 15 tests passed, TypeScript passed, and ESLint completed with no errors (94 existing warnings). The new Hostinger runner mode was verified with mocked fetch: expected HTTPS endpoint, bearer header, redirect refusal, and count-only output; no network request was sent.
- The isolated localization status check exposed missing plural variants in the new record-count label. Added the repository-required one/other keys across all three locales. Full `verify:i18n` now passes; existing punctuation warnings remain informational.
- Source main and teacher main both pointed to `61bf8346` before publication, and source main CI was successful. The selected feature branch is an ancestor of source main; delivery can use a normal PR without switching the shared checkout or rewriting history.
