# Event Workbench Publication and Consistency

Status: Implemented; local verification passed. Release verification is tracked on the GitHub PR.
Created: 2026-10-14 13:40 Asia/Kuala_Lumpur

## Context and decisions

The user approved extracting the existing uncommitted event-workbench improvements
from the old event-reservation-guarantees checkout into the prepared
`feature/event-part` branch, keeping current main intact. All seven previously
reviewed requirements are in scope: status-aware publication and retry, unsaved
location protection, a publication checklist, default-hours explanation, explicit
map placement, shared inputs and page-address guidance, and a complete filtered
list with separate operating/approval states. Reorder the location form as venue,
map, schedule, then intake. No new design exploration is needed.

## Reuse Audit and Reuse Decisions

All paths below are relative to `/Users/tanzhengyang/Documents/GitHub/MyWisata-Malaysia-Tourism-Portal`.

| Candidate and exact path | Decision and reused behavior |
| --- | --- |
| `app/admin/promotion-campaigns/page.tsx` | Extend existing load/edit/save/transition functions and layout; adapt the reviewed old-worktree patch with three-way application, preserving main changes. |
| `app/admin/promotion-campaigns/event-locations-editor.tsx` | Extend current validation, preview, save, removal and cancellation; expose existing draft-open state to the parent. |
| `lib/promotion-campaigns/validation.ts` | Reuse campaignCreateSchema and campaignLocationSchema unchanged for visible readiness/field feedback. Do not invent a parallel validation policy. |
| `components/admin/staff-conduct-panel.tsx` | Reference full existing list behavior: 15 default, 25/50 options, filter-first pagination, resetting page on filters/page-size changes, previous/next and empty states. |
| `components/admin/staff-conduct-filtering.ts` | Reuse generic paginateStaffConductRecords unchanged; show total from filtered records and clamp page using the helper. |
| `components/admin/filter-bar.tsx` | Reuse AdminFilterBar and adminFilterControlClassName unchanged. Add the activity page to the existing filter consistency contract. |
| `components/ui/input.tsx`, `components/ui/textarea.tsx`, `components/ui/button.tsx` | Reuse existing focus/error/disabled controls and tokens unchanged. Reject old-worktree's global Button change because it affects unrelated surfaces and is unnecessary for this integration. |
| `components/map/map-view.tsx` | Reuse current map unchanged; default map center remains distinct from an explicitly selected marker. |
| `lib/promotion-campaigns/locations.ts`, `lib/datetime/date-input.ts`, `lib/datetime/malaysia.ts` | Extend the existing event-location domain helper with read-only Admin schedule derivation, reusing Malaysia wall-clock conversions. Preserve public event behavior. |
| `app/i18n/locales/en/admin.json`, `app/i18n/locales/ms/admin.json`, `app/i18n/locales/zh-CN/admin.json` | Merge only donor changes within promotionCampaigns, preserving all main and unrelated translation keys. Reject copying entire catalogs or common.json because they include unrelated financial/notification work. |
| Existing page/editor/domain tests and `app/admin/__tests__/filter-consistency.contract.test.ts` | Extend behavioral coverage and the existing filter inventory. No new shared component is required. |

**Reuse audit complete.**

## Phases and exact files

- [x] Back up selected source files and the clean target; fast-forward the same
  branch to current origin/main. Never switch/create branches or worktrees.
- [x] Apply only test hunks for
  `app/admin/promotion-campaigns/__tests__/page.test.tsx`,
  `lib/promotion-campaigns/__tests__/operational-state.test.ts`, and create
  `app/admin/promotion-campaigns/__tests__/event-locations-editor.test.tsx`.
  Run those tests against main and confirm publication/readiness/map failures.
- [x] Apply the exact donor patch for page.tsx, event-locations-editor.tsx and
  lib/promotion-campaigns/locations.ts with three-way reconciliation; preserve
  current main intent in any overlapping hunk. Merge only approved catalog keys.
- [x] Extend filter-consistency.contract.test.ts to include the existing activity
  page. Exercise page-size options, next/previous controls, total records under
  active filters, and reset on search/status/date/page-size changes.
- [x] Run focused tests and TypeScript; resolve only confirmed scope blockers.
  Complete one final independent read-only review after the implementation.
- [x] Run full tests, lint, localization checks, typegen/typecheck and production
  build after the focused repair. Prepare the scoped feature commit.
- Release sequence: push feature/event-part, create a main-targeting PR, and wait
  for actual GitHub CI. Record the resulting PR/run links in the backup manifest
  and PR description. Do not automatically merge or deploy this new PR.

## Scope boundaries, dependencies and risks

Files not touched: KYC/auth/permission guards, payments/refunds/wallet/checkout,
API routes, Supabase migrations, common.json, generic Button, and hosting/cron
configuration. No dependency or database change, and no remote data write.
Source worktree stays untouched. Its remaining 79 mixed changes are not release
input. Page save/publish API contracts and server-side eligibility remain the
authoritative rules; client checks only improve feedback.

Publication must submit a draft/rejected row exactly once, then approve;
pending rows can retry approval without another create/submit. A failed
location save retains the saved campaign and remaining location drafts. Child
editing must prevent publication, list switches and accidental discard.

Browser acceptance uses an isolated mocked flow only, without creating real
events, modifying vendors, charging payments or uploading private customer data.
If browser access is unavailable, report the specific unverified portion rather
than claim visual acceptance. Source fingerprints and Git diff allow rollback
without dropping the donor's uncommitted work.

## Verification and acceptance

- Existing-draft publication: PATCH actions exactly submit, approve.
- Failed approval: retry approve only; saved campaign/id/version retained.
- Save draft: no submit/approve; missing poster/location allowed by existing API.
- Incomplete and child-edited drafts: visible reason and disabled publication.
- Map: no marker until explicit placement; location save validates current data.
- Default hours explain they prefill new locations only. Slug has format help
  and route preview; existing shared fields and tokens are used.
- Lists separate approval from operating state; name/slug, approval, schedule
  and date filters run before pagination; total and empty states reflect filters;
  options remain 15/25/50; filters/page size reset to page one.
- Final diff contains only the ten scoped code/catalog/test files and this plan.
- Check original main remains an ancestor, CI passes on the PR head/merge tree,
  and no history rewrite or force push occurs.

## Backup

/Users/tanzhengyang/.codex/backups/mywisata/event-workbench-20261014-134035

## Verification evidence

- Before implementation, the imported tests exposed the original triple PATCH
  sequence `submit, submit, approve`, missing readiness/unsaved protection, and
  absent pagination/schedule behavior. Red run: 9 failing / 11 passing tests.
- After integration and list-contract additions: 4 files / 26 tests passed.
- Final full suite: 1,083 test files / 4,986 tests passed; 12 files / 42 tests
  skipped. TypeScript passed. Full lint: 0 errors / 93 warnings; changed-file
  lint passed again after the focused repair.
- Localization initially rejected two split translation sentences. Replaced
  them with `checkDone/checkMissing` item interpolation and `scheduleLine`
  status interpolation in all three catalogs; complete verification passed.
- One independent final review and one focused translation-repair re-review
  found no remaining must-fix in the approved scope. Additional tests for a
  new-event POST followed by failed location save, and earlier client feedback
  for out-of-range list-row dates, remain follow-ups; server guards stay intact.
- Isolated real React/shared-UI browser fixture at
  `/Users/tanzhengyang/.codex/visualizations/2026/10/14/event-workbench-check/`
  verified Chinese form/help, disabled incomplete publication, unsaved-location
  protection, explicit marker selection state, existing-draft publication,
  25-per-page and filtered total/page resets, and dark appearance. Requests
  were in-memory only; no real event/vendor data or payment was modified.
- MapView was visibly mocked, so actual map rendering/geocoding was not tested.
  Screenshots 02-chinese-form.jpg, 03-location-unsaved.jpg and
  04-filtered-list.jpg were saved and visually inspected. No claim of live
  deployment acceptance is made.
- Source file fingerprints still match the backup; the donor worktree is unchanged.

- Final production build and its TypeScript validation passed. The temporary
  browser fixture server was stopped; screenshots and fixture remain available.
