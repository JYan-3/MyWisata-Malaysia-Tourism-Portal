# Automatic teacher repository sync

**Status:** Implemented and verified on 2026-09-28. The user chose the recommended 15-minute check.

## Context

`TanZhengYang0912/MyWisata-Malaysia-Tourism-Portal` is the source. `JYan-3/MyWisata-Malaysia-Tourism-Portal` is the teacher's target. Both remote `main` branches currently point to `e1228f5e7ff8f66fc96cd914c709e494a2940a54`. The previous manual sync required a guarded replacement because the two repositories originally had unrelated histories; future source commits can now advance the target normally.

## Reuse Audit and Reuse Decisions

| Candidate | Exact path | Decision | Reason |
| --- | --- | --- | --- |
| Existing CI workflow | `.github/workflows/ci.yml` | Reuse its Actions conventions (`checkout`, explicit permissions and concurrency); keep it separate | CI verifies code on pushes and PRs. Repository sync needs a schedule and target-only write permission, so extending CI would mix unrelated jobs and credentials. |
| Catalogue sync scripts | `scripts/sync-verified-vendor-catalogue.mjs`, `scripts/sync-verified-vendor-entity-media.mjs` | Reject | These synchronize domain records and media, not Git branches. |

**Reuse audit complete.** No existing repository mirror workflow or Git helper implements this task.

## Decisions

- Add one workflow to the source `main`, then bootstrap the identical commit onto the teacher's `main`. Its job runs only when `github.repository` is the teacher repository.
- On the teacher repository, check every 15 minutes at minutes 7, 22, 37 and 52 UTC. Also allow a manual run. GitHub may delay scheduled runs, and public-repository schedules can be disabled after 60 days without activity.
- Use the teacher repository's own short-lived `GITHUB_TOKEN` with only `contents: write`. Do not copy a personal GitHub token or any application `.env` value into Actions.
- Fetch the source's public `main`. Push only if the target commit is an ancestor of the source commit. Never force-push. If the teacher changed `main` independently, fail visibly and preserve those commits.
- Fail visibly if an incoming source update changes `.github/workflows/`: GitHub's default Actions token may not be allowed to modify workflow files. Synchronize such updates manually with an authorized credential.
- A push made with `GITHUB_TOKEN` may not trigger the target repository's CI workflow. This sync does not promise a deployment or application build.

## Implementation Plan

### Phase 1: Add the workflow

**Files to create:** `.github/workflows/sync-teacher-main.yml` in the source repository. The same file arrives in the teacher repository during bootstrap. **Functions/components affected:** the `sync` GitHub Actions job only. **Files not touched:** `.github/workflows/ci.yml`, application source, tests, `.env*`, Supabase migrations and deployment settings. **New dependencies:** none. **Database changes:** none.

The workflow has `schedule` and `workflow_dispatch` triggers, a teacher-repository guard, `contents: write` on its one job, `actions/checkout@v4` with full history, and a shell step that:

1. Fetches target `main` from `origin` and source `main` from the public source URL.
2. Exits successfully if their SHAs match.
3. Exits with a clear error if target is not an ancestor of source.
4. Exits with a clear error if `git diff --name-only target source -- .github/workflows` finds any changes.
5. Uses an ordinary `git push origin source_sha:refs/heads/main`; a concurrent target update makes the push fail rather than overwrite it.

### Phase 2: Bootstrap both repositories

Commit the workflow and this plan on a branch based on the latest source `main`. Push that commit to the source `main` with an ordinary fast-forward push. Push the same commit to the teacher's `main` with an ordinary fast-forward push. Abort if either remote has moved unexpectedly.

### Phase 3: Prove the sync path

Run the teacher workflow manually once when both SHAs match and confirm a no-op success. Record that evidence in this plan and push the documentation-only update to the source `main` only. Run the teacher workflow manually again; verify it pushes that source commit to the teacher `main`. Confirm both remote SHAs match. The periodic trigger uses this same job; do not wait through multiple scheduled intervals to repeat the same test.

## Verification

- Parse the new YAML and check the shell block syntax. Review that no secret value, force flag, or alternate destination can be introduced by workflow inputs.
- Run `npm run lint`, `npx tsc --noEmit`, and affected tests if useful and available; this change has no application-code tests. Confirm CI's result on the source commit.
- Review the workflow's exact permissions, repository guard, divergence check and workflow-file guard once before the remote pushes.
- Confirm source and target `main` SHAs after bootstrap and after the manual update test. Confirm the existing teacher backup branch remains unchanged.

## Activation record

- Bootstrap commit `949113af2041ecfec20e6cbccfd887f062b8c539` was pushed normally to both `main` branches; both remotes reported this SHA afterward.
- The teacher repository recognized **Sync teacher repository main** as an active workflow. [Manual no-op run 36347757030](https://github.com/JYan-3/MyWisata-Malaysia-Tourism-Portal/actions/runs/36347757030) succeeded and logged that both `main` branches matched at `949113af`.
- Source-only documentation commit `06ca50fcf8f7934396c3358ee6554da58caeb2be` was pushed to the source `main`. [Manual sync run 36348128431](https://github.com/JYan-3/MyWisata-Malaysia-Tourism-Portal/actions/runs/36348128431) used the teacher repository's own token to fast-forward its `main` from `949113af` to `06ca50fc`; both remote SHAs matched afterward. The source CI runs for both commits succeeded.
- Local verification: the workflow YAML parsed and its shell block passed `bash -n`; `npm run lint` exited 0 with 80 existing warnings and `npx tsc --noEmit` exited 0. The prior teacher initial commit `71a72585` remains on its backup branch, currently named `MyWisata-Malaysia-Tourism-Portal/backup-main-before-sync`.

## Risks and limits

- The caller can push to the teacher repository but cannot read its Actions policy settings. If its owner restricts workflow write permission, the real manual run will expose that and owner action will be required.
- A teacher-only commit, a rewritten source history, or a workflow-file update stops the automatic push and requires manual review.
- Scheduled jobs are not instantaneous and GitHub may delay them or disable them after a long inactive period.


## 2026-10-23 approved event-driven extension

**Status:** Implementation authorized; credential activation and live end-to-end verification pending.
**Goal:** Source main CI success immediately requests the existing target sync; retain scheduled/manual recovery and never mirror an unverified commit.
**Architecture:** A source-only workflow_run job checks out trusted default-main code, validates an exact successful main/push CI event, and dispatches the fixed teacher workflow using a dedicated target Actions-write token. The target validates optional expected SHA, verifies that exact fetched source main SHA has passed the latest CI/push run, then reuses existing fast-forward and workflow-file guards.
**Scope:** current checkout and feature/portal-readiness; no new branch/worktree. Preserve all unrelated dirty files.

### Reuse Decisions
- Extend .github/workflows/sync-teacher-main.yml: cron/manual entry points, repository guard, ancestry and workflow-file guards remain. Add main-only ref, fixed checkout, optional source_sha input, and exact-source-CI check.
- Reuse .github/workflows/ci.yml without modifying it: CI completion supplies the trigger.
- Create .github/workflows/request-teacher-sync.yml: source-only CI-completed trigger; no duplicate mirror implementation or untrusted CI artifacts.
- Create scripts/teacher-repo-sync.mjs: built-in Node fetch, fixed GitHub endpoints, verified-SHA checks shared by two workflow consumers.
- Reject scripts/run-event-cron.mjs: website-origin and CRON_SECRET policy are unrelated; do not mix GitHub credentials with deployment tasks.
- Create scripts/__tests__/teacher-repo-sync.test.ts using existing Vitest and mocked HTTP patterns.

Reuse audit complete. No new dependencies, database changes, Node upgrade, application behavior, Hostinger operation, or credential reuse.

### Execution and interfaces
1. Add failing tests for verifySourceMainCi(sha, request), sourceCiTriggerSha(event), and requestTeacherSync(event, token, request). Cover failed/pending/missing or mismatched CI, foreign/PR/feature-branch events, stale SHA, missing secret, fixed API destination/body, no redirected credentials, and sanitized HTTP errors.
2. Implement scripts/teacher-repo-sync.mjs. CLI verify <sha> returns ready/not-ready for target shell gating. CLI dispatch reads GITHUB_EVENT_PATH only for workflow_run and requires TEACHER_SYNC_DISPATCH_TOKEN. Public CI reads carry no credential; only the fixed target workflow-dispatch POST carries the token.
3. Extend target workflow with source_sha input validation and main-only execution. Check source CI before every push, including cron/manual. Add source workflow with completed CI/main/push/success/source-repository guards; checkout refs/heads/main, persist-credentials false, contents read, timeout and no user-selectable destination/ref.
4. Verify focused tests, YAML parsing, bash syntax, lint, TypeScript, diff checks, and one independent permission review. Create a reviewable PR and require CI success.

### Activation and acceptance
- JYan owner creates a fine-grained token for only JYan-3/MyWisata-Malaysia-Tourism-Portal, Actions read/write and an expiry. Store it as TEACHER_SYNC_DISPATCH_TOKEN in Tan source Actions secrets. Do not create/store/reuse the current broad gh login token. No token values in chat/logs/code.
- Workflow changes require a one-time authorized fast-forward bootstrap to the teacher after reviewed source CI passes; both repositories must contain identical workflow files, with source/target repository guards. Never force-push or remove the workflow-change guard.
- Verify no-op authenticated dispatch, then a CI-passed non-workflow source update through the event path; confirm target and source main SHAs match. Pending/failed/stale CI and branch divergence must prevent writes.
- Missing/expired credential fails visibly; schedules remain as recovery but cannot provide immediate delivery. GitHub scheduling/runner queue latency remains outside this implementation.
- Do not claim activation complete until the secret exists and the real source-CI-to-target event path is observed.
