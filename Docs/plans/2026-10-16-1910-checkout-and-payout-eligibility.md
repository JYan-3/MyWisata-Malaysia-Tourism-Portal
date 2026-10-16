# Checkout and payout eligibility implementation plan

**Status:** Approved for inline execution. The owner confirmed one effective unpaid Checkout per Guest/account and manual review after eligibility loss on 2026-10-16.
**Workspace:** `/Users/tanzhengyang/Documents/GitHub/MyWisata-Malaysia-Tourism-Portal`, branch `feature/event-part`.

## Context and decisions

Keep independent Email, Phone, Profile and KYC facts. Registered purchases require active Email and effective commerce permission; Guest purchases retain separate ownership. Withdrawal eligibility and destination identity must still hold when payout is claimed. An external verified receipt must survive eligibility loss without fulfilment or automatic refund.

One effective unpaid Checkout means pending_payment/requires_action with expires_at in the future. Same-key retries retain current idempotency semantics. A different key may reuse an identical pending request; changed contents must finish/cancel the old Checkout first. Expired holds remain subject to existing cleanup and late-payment evidence handling. This cap is per subject, not a global purchase quantity limit or a defence against unlimited new identities.

Hostinger hPanel confirms CDN Active. Origin bypass prevention is not confirmed. Add an explicit trusted-proxy adapter but keep the conservative fallback until the operator verifies that every application request crosses the documented CDN proxy. Never trust first X-Forwarded-For or arbitrary X-Real-IP by default.

## Reuse Decisions

| Exact path / installed function | Decision | Reuse |
| --- | --- | --- |
| `lib/checkout/guest-session.ts` | Extend | Existing hashed rate keys, atomic reservation, expiry cleanup; add validated configured address source. |
| `lib/wallet/request-ip.ts` | Reject for security rate limits | First forwarded address is caller-controlled; keep audit helper unchanged. |
| `supabase/migrations/20261002004602_guest_checkout_transactions.sql` | Reuse installed shared cores in forward migration | Preserve subject checks, inventory, booking, free orders and account/Guest wrappers. |
| `supabase/migrations/20261011171225_event_checkout_commitment_guards.sql` | Extend installed exception recorder | Receipt binding, canonical hold release, refund evidence, deduplication; disable auto processing for new manual cases. |
| `app/admin/reports/reconciliation/page.tsx`, `lib/admin/event-operations-filters.ts` | Reuse/extend in place | Existing searches, kind/handling/owner/deadline filters, reset-to-page-one, filtered totals, fixed 25-row server pages and previous/next. No new list page/page-size rules. |
| `lib/payouts/execute-approved-withdrawal.ts`, installed `start_withdrawal_payout_attempt` | Extend | Existing provider idempotency, claim token, immutable destination, audit and hold lifecycle. |
| `app/customer/orders/[id]/page.tsx`, `app/api/customer/orders/[orderId]/payment-session/route.ts` | Extend | Existing owner-authorized payment resume and canonical cancellation. |

**Reuse audit complete.**

## Phases and exact files

1. `lib/checkout/guest-session.ts`: validate configured Vercel/Hostinger CDN addresses using Node isIP; use last forwarded entry only in explicitly trusted Hostinger mode. `lib/checkout/__tests__/guest-session.test.ts`: spoofed/invalid/default source contracts. Document activation conditions here; do not change hosting settings.
2. `supabase/migrations/20261016111059_checkout_subject_commitment_guards.sql`: private per-owner lock/budget helpers; forward patch shared ordinary/event cores after verified markers. Reuse matching requests without new holds, reject changed requests with owner-bound order context; add active-owner indexes. Canonical finalizer rechecks current commerce eligibility before debit/commit. Verified provider settlement records manual exceptions for eligibility loss or expired holds before terminal-state rejection. Reuse exception receipt/refund machinery with auto_process=false for these reasons. Extend the existing owner-authorized payment-session POST with explicit cancellation and all-POST same-origin validation. `lib/checkout/errors.ts`, `app/api/checkout/prepare/route.ts`, `app/api/customer/event-reservations/route.ts`, `app/customer/checkout/page.tsx`, `components/customer/event-reserve-dialog.tsx`, `app/customer/orders/[id]/page.tsx`: actionable existing-order recovery and cancellation, preserving Guest/account authorization.
3. `supabase/migrations/20261016111120_withdrawal_execution_eligibility.sql`: current capability/destination checks inside execution claim, user-before-request lock order, protected TNG verification snapshot for new requests. Unknown historical TNG identity enters manual review. Atomic hold/audit preserves reserved money. `lib/payouts/execute-approved-withdrawal.ts`: typed review result bypasses provider and failure/release mutation.
4. `app/admin/reports/reconciliation/page.tsx` and `app/i18n/locales/{en,ms,zh-CN}/{admin,customer}.json`: explain new manual-review reasons and recovery actions using existing UI primitives. Preserve unrelated dirty translation changes.

## Database, dependencies and boundaries

Two forward migrations only; no edits to applied history. Internal helpers use app_private, fixed search paths and revoked execute privileges. No npm dependencies. Register both filenames in `supabase/migrations/__tests__/canonical-history.test.ts`, preserving other Chats' entries.

Excluded: OCR/KYC processing, Trip/content translation, gateway replacement, new reserve percentages, new verification tiers, Staff expiry, global booking cutoff, teacher access and manual redeployment. Do not execute real payments, refunds or payouts.

## Verification

- Targeted Vitest: Guest address selection, Checkout errors/recovery, payout manual-review result (no provider call and no record_withdrawal_execution_failure), affected routes and reconciliation UI.
- Disposable loopback PostgreSQL using existing `scripts/test-event-management-db.mjs` patterns: actual function installation, simultaneous different-key attempts for one subject, independent subjects, matching retry, changed cart, expiry/cancellation release, verified receipt replay/conflict, no fulfilment after suspension, withdrawal hold preserving money/claim state. Never use linked DB as a test fixture.
- `npm run lint`, `npx tsc --noEmit`, affected tests once after final change. Independent bounded luna_worker review before final verification; at most one focused re-review for confirmed blocking issues.
- Before any remote migration, inspect installed signatures/markers and active duplicate pending sessions; never silently cancel historical paid/provider-unknown records. Remote application and application publication must be reported separately from local completion.

## Risks and operational limits

Owner locks serialize only one buyer's prepares; indexes keep active lookup bounded. Existing inventory hot rows and provider/database capacity still need a separate measured load test before any concurrent-user capacity promise. SQL marker drift aborts installation. Existing TNG requests lacking reliable identity snapshots must be reviewed, never silently inferred. Trusted Hostinger mode remains disabled until the CDN/origin trust boundary is confirmed. Signed-in callers cannot use Guest fallback. Verified money is recorded even when the account cannot buy; no automatic financial decision is introduced.


## Execution evidence — 2026-10-16

- Local implementation completed on `feature/event-part`; no other Chat changes were reverted.
- Bounded luna_worker review identified trigger ordering, claimed-payout hold/reject races and POST origin checks. All three were repaired; one focused re-review found no remaining must-fix issue in those repairs.
- Phone snapshots derive the provider from the destination before the later destination-population trigger. Unknown historical TNG identity stays on hold; the existing rejection/new-request process is available after review. Resuming alone never rewrites old identity evidence.
- Claimed payouts cannot be held/rejected; a trigger exception rolls back any preceding wallet release in that transaction. RPC transport failures and invalid claim responses never call the provider or the failure/release mutation.
- `scripts/lib/checkout-eligibility-db.mjs` extends the existing loopback-only runner. `supabase/tests/checkout_subject_core_baseline.sql` is a no-data snapshot of the installed ordinary core. The other new SQL fixtures exercise inventory/event budget sharing, retries/changed quantities, cancellation/expiry, delayed provider reopen protection, eligibility loss, exact receipt replay/conflicts, TNG trigger ordering, reserve retention and claim permissions. Two real connections verify same-owner exclusion and independent-owner locks. All passed on disposable PostgreSQL 18.4 installed outside the repository; no production fixture was used.
- Full repository lint excluding old `output/` copies: zero errors, 93 existing warnings. Source TypeScript check passed using `/tmp/mywisata-commitment-tsconfig.json` extending the repository config, with only output copies excluded and typeRoots resolved to this repository. Plain `npx tsc --noEmit` remains contaminated by the old output checkout. Both i18n coverage/defaultValue checks passed.
- Hostinger CDN is Active; origin bypass prevention remains unconfirmed. `GUEST_TRUSTED_PROXY` was not enabled and no hosting settings were changed. The safe shared fallback remains until that operational condition is confirmed.
- No real payment, refund or payout was executed. No arbitrary reserve percentage, role tier, OCR or Staff expiry change was introduced.

- Final affected Vitest run: 10 files / 81 tests passed. Focused ESLint passed.
- Both migrations applied successfully to linked FYP `ncdlaehknicabzjqskvk`. Installed helper execute privileges deny anon/authenticated. Supabase-assigned history timestamps were aligned to the committed migration versions only after verifying exact SQL MD5 equality (Checkout `eaa7cec20dc5fad692e7161b9563dba1`, Withdrawal `0da65465062187a958b62bcbe2f739ff`); no schema SQL was changed during alignment.
