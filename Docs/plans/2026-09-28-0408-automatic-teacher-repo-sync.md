# Automatic teacher repository sync

**Status:** Approved for implementation on 2026-09-28. The user chose the recommended 15-minute check.

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

## Risks and limits

- The caller can push to the teacher repository but cannot read its Actions policy settings. If its owner restricts workflow write permission, the real manual run will expose that and owner action will be required.
- A teacher-only commit, a rewritten source history, or a workflow-file update stops the automatic push and requires manual review.
- Scheduled jobs are not instantaneous and GitHub may delay them or disable them after a long inactive period.
