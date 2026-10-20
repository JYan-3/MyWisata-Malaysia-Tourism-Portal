# Isolate Trip Time Slot E2E Accounts

**Status:** Complete

## Context

`tests/e2e/trip-time-slots.spec.ts` currently signs in as the shared `customer3`
account, snapshots that account's cart, adds Trip items, then restores the cart.
Concurrent runs can observe or delete each other's cart rows and restore stale
quantities.

## Decisions

- Create a unique, confirmed customer account for each test run through the
  existing Supabase Auth admin API.
- Use that account for the Trip and cart flow so every run owns a separate cart.
- Clean up the Trip, cart items, cart, Auth user, and public user row in `finally`.
- Keep seeded catalogue reads shared and read-only.

## Reuse Decisions

- Extend `tests/e2e/helpers/demo.ts` `signIn` with an optional password while
  preserving the existing demo-password default for all callers.
- Reuse the unique temporary-user lifecycle pattern in
  `scripts/verify-affiliate-links-rls.mjs`.
- Reject restoring `customer3`'s cart snapshot: concurrent runs can overwrite
  each other's changes.
- Reject a separate browser or worktree: the current E2E uses one role and one
  shared local Next.js server; independent account data is the needed boundary.

## Phases

1. Create a per-run customer and use it for Trip/cart setup and browser sign-in.
2. Replace snapshot-based cart restoration with deterministic deletion of only
   the temporary user's test data and account rows.
3. Run the focused Playwright spec and targeted lint/diff checks.

## Files to modify

- `tests/e2e/trip-time-slots.spec.ts`
  - Create/clean a unique Supabase Auth customer, Trip, and cart.
- `tests/e2e/helpers/demo.ts`
  - Allow `signIn(page, email, password)` with the current demo password as its
    default.
- `Docs/plans/2026-10-16-0155-trip-e2e-account-isolation.md`
  - Record this implementation and verification result.

## Scope boundaries

Files not being touched: customer Trip/cart/checkout product code, Supabase
migrations, Playwright global configuration, and unrelated working-tree edits.

New dependencies: none.

Database schema changes: none. The test creates temporary runtime records and
removes them in cleanup.

## Risks

- Auth user creation triggers profile, customer-role, and wallet rows. Cleanup
  must delete the account's commerce/Trip data and then remove both Auth and
  public user rows; a failure should remain visible rather than silently leak.
- The shared catalogue remains a read-only dependency, so unavailable seeded
  products can still skip/fail the test.
- The linked Supabase project still handles one temporary Auth lifecycle per
  run, but each run no longer reads, changes, or restores another user's cart.

## Verification

- Run `npx playwright test tests/e2e/trip-time-slots.spec.ts --workers=1`.
- Run `npx eslint tests/e2e/trip-time-slots.spec.ts tests/e2e/helpers/demo.ts`.
- Run `git diff --check`.

## Result

- The focused Playwright run creates a per-run customer and reaches the
  persistence assertion; cleanup runs from `finally` after the assertion fails.
- The assertion exposes an existing Trip-time persistence defect: after
  selecting the activity outlet slot (`09:00`), `trip_items.scheduled_time`
  remains at the deliberately invalid seed value (`00:26`). The product action
  is rejecting the update, so the subsequent checkout checks cannot run yet.
- Targeted ESLint and `git diff --check` pass.
