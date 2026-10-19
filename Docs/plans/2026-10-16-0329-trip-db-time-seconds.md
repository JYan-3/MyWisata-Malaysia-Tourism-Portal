# Accept PostgreSQL TIME Values in Trip Scheduling

**Status:** Complete

## Context

The database stores `trip_items.scheduled_time` as PostgreSQL `TIME`, which
Supabase returns as `HH:mm:ss`. The Trip planner's shared chronology parser
accepts only `HH:mm`, so later schedule edits reject a valid itinerary after
loading an already-scheduled stop.

## Decisions

- Keep strict same-day, sequence-based chronology validation.
- Parse PostgreSQL `HH:mm:ss` values at minute precision, matching the planner's
minute-based choices and existing `normalizeTripTime` display behavior.
- Give end-to-end persistence checks up to 30 seconds for local server actions,
  consistent with the configured action timeout.
- Add helper and domain regression coverage before changing production code.
- Preserve the existing isolated Playwright test and use it to verify schedule
selection, operational-hours options, and checkout selection after the fix.

## Reuse Decisions

- `lib/customer/trip-planner.ts` `tripTimeToMinutes`: extend the existing shared
  parser used by both chronology validation and itinerary time bounds.
- `lib/customer/trip-time-options.ts` `normalizeTripTime`: retain its existing
  display normalization; it confirms that rendering already supports database
  `TIME` values.
- `backend/domains/__tests__/trips.test.ts` and
  `lib/customer/__tests__/trip-planner.test.ts`: extend existing domain/helper
  suites rather than creating new test infrastructure.
- `tests/e2e/trip-time-slots.spec.ts`: reuse the isolated end-to-end test as the
  final integration check; no production UI changes are planned.

**Reuse audit complete.**

## Phases

1. Add failing tests for chronology and a subsequent schedule update when the
   preceding stop is returned as PostgreSQL `HH:mm:ss`.
2. Extend the shared time parser to accept both `HH:mm` and `HH:mm:ss`, while
   retaining range validation and minute precision.
3. Run focused helper/domain tests, the isolated Trip Playwright test, lint, and
   diff checks.

## Files to modify

- `lib/customer/trip-planner.ts` — `tripTimeToMinutes` parsing.
- `lib/customer/__tests__/trip-planner.test.ts` — PostgreSQL time-format
  chronology and bounds coverage.
- `backend/domains/__tests__/trips.test.ts` — domain schedule-update regression.
- `tests/e2e/trip-time-slots.spec.ts` — persisted-time assertions and bounded
  server-action polling.
- `Docs/plans/2026-10-16-0329-trip-db-time-seconds.md` — implementation and
  verification record.

## Scope boundaries

Files not being touched: `backend/domains/trips.ts`, Trip UI/actions, checkout
implementation, Supabase migrations/schema, package manifests, and unrelated
working-tree changes.

New dependencies: none.

Database changes: none.

## Risks

- Parser must still reject malformed strings and out-of-range hour/minute
  values; tests will preserve the current validation behavior.
- Planner choices have minute precision, so persisted seconds are ignored when
  comparing times and deriving bounds.

## Verification

- `npx vitest run lib/customer/__tests__/trip-planner.test.ts backend/domains/__tests__/trips.test.ts`
- `npx playwright test tests/e2e/trip-time-slots.spec.ts --workers=1`
- `npx eslint lib/customer/trip-planner.ts lib/customer/__tests__/trip-planner.test.ts backend/domains/__tests__/trips.test.ts`
- `git diff --check`

## Result

- `tripTimeToMinutes` now accepts valid `HH:mm` and PostgreSQL `HH:mm:ss`
  strings, while still rejecting out-of-range hours, minutes, and seconds.
- The original strict chronology rule is unchanged and continues to apply to
  both schedule edits and itinerary bounds.
- The isolated Playwright flow passes: activity options match the selected
  outlet's available slots, food options match operational hours, both cart
  lines are selected by default, and both items appear at checkout.
- Focused Vitest: 2 files, 31/31 tests passed.
- Focused Playwright: 1/1 passed in Chromium.
- Focused ESLint and `git diff --check` passed.
- `npx tsc --noEmit` remains blocked by an unrelated existing generated route
  type error at `.next/types/app/api/admin/kyc/submissions/route.ts:44` for
  `app/api/admin/kyc/submissions/route.ts`.
