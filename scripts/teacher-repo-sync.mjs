import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const sourceRepository = 'TanZhengYang0912/MyWisata-Malaysia-Tourism-Portal';
const teacherRepository = 'JYan-3/MyWisata-Malaysia-Tourism-Portal';
const apiOrigin = 'https://api.github.com';
const headers = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2026-03-10',
};

/** @param {unknown} value */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {unknown} value */
function isSha(value) {
  return typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
}

/** @param {unknown} run @param {string} sha */
function isSourceMainCi(run, sha) {
  return isRecord(run) && run.name === 'CI' && run.path === '.github/workflows/ci.yml'
    && run.event === 'push' && run.head_branch === 'main' && run.head_sha === sha
    && isRecord(run.head_repository) && run.head_repository.full_name === sourceRepository;
}

/** @param {string} path @param {typeof fetch} request */
async function readSourceApi(path, request) {
  let response;
  try {
    // Public reads never receive the cross-repository dispatch credential.
    response = await request(`${apiOrigin}/repos/${sourceRepository}/${path}`, {
      headers, redirect: 'error', signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error('source_ci_unavailable');
  }
  if (!response.ok) throw new Error('source_ci_unavailable');
  try {
    return await response.json();
  } catch {
    throw new Error('source_ci_response_invalid');
  }
}

/** @param {string} sha @param {typeof fetch} request */
export async function verifySourceMainCi(sha, request = fetch) {
  if (!isSha(sha)) throw new Error('source_sha_invalid');
  const ref = await readSourceApi('git/ref/heads/main', request);
  if (!isRecord(ref) || !isRecord(ref.object) || !isSha(ref.object.sha)) {
    throw new Error('source_ci_response_invalid');
  }
  if (ref.object.sha !== sha) return { ready: false, reason: 'source_main_advanced' };

  const query = new URLSearchParams({ head_sha: sha, branch: 'main', event: 'push', per_page: '1' });
  const result = await readSourceApi(`actions/workflows/ci.yml/runs?${query}`, request);
  if (!isRecord(result) || !Array.isArray(result.workflow_runs)) {
    throw new Error('source_ci_response_invalid');
  }
  if (result.workflow_runs.length === 0) return { ready: false, reason: 'source_ci_missing' };
  const run = result.workflow_runs[0];
  if (!isSourceMainCi(run, sha)) throw new Error('source_ci_response_invalid');
  if (run.status !== 'completed' || run.conclusion !== 'success') {
    return { ready: false, reason: 'source_ci_not_successful' };
  }
  return { ready: true, sha };
}

/** @param {unknown} event */
export function sourceCiTriggerSha(event) {
  if (!isRecord(event) || event.action !== 'completed' || !isRecord(event.repository)
    || event.repository.full_name !== sourceRepository || !isRecord(event.workflow_run)) return null;
  const run = event.workflow_run;
  return isSha(run.head_sha) && isSourceMainCi(run, run.head_sha)
    && run.status === 'completed' && run.conclusion === 'success' ? run.head_sha : null;
}

/** @param {unknown} event @param {string | undefined} token @param {typeof fetch} request */
export async function requestTeacherSync(event, token, request = fetch) {
  const sha = sourceCiTriggerSha(event);
  if (!sha) return { requested: false, reason: 'source_event_ineligible' };
  if (!token?.trim()) throw new Error('sync_dispatch_token_missing');
  const verification = await verifySourceMainCi(sha, request);
  if (!verification.ready) return { requested: false, reason: verification.reason };
  let response;
  try {
    response = await request(`${apiOrigin}/repos/${teacherRepository}/actions/workflows/sync-teacher-main.yml/dispatches`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { ...headers, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: 'main', inputs: { source_sha: sha } }),
    });
  } catch {
    throw new Error('sync_dispatch_unavailable');
  }
  // GitHub deployments support both the legacy empty response and run metadata.
  if (response.status !== 200 && response.status !== 204) throw new Error('sync_dispatch_rejected');
  return { requested: true, sha };
}

async function main() {
  if (process.argv[2] === 'verify') {
    const result = await verifySourceMainCi(process.argv[3] ?? '');
    process.stdout.write(`${result.ready ? 'ready' : 'not-ready'}\n`);
    if (!result.ready) process.stderr.write(`${result.reason}\n`);
    return;
  }
  if (process.argv[2] !== 'dispatch' || process.env.GITHUB_EVENT_NAME !== 'workflow_run') {
    throw new Error('source_event_ineligible');
  }
  let event;
  try {
    event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH ?? '', 'utf8'));
  } catch {
    throw new Error('source_event_invalid');
  }
  const result = await requestTeacherSync(event, process.env.TEACHER_SYNC_DISPATCH_TOKEN);
  process.stdout.write(result.requested
    ? `Teacher sync requested for ${result.sha}; check the target run for completion.\n`
    : `Teacher sync skipped: ${result.reason}.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const allowedCodes = new Set([
      'source_sha_invalid', 'source_ci_unavailable', 'source_ci_response_invalid',
      'source_event_ineligible', 'source_event_invalid', 'sync_dispatch_token_missing',
      'sync_dispatch_unavailable', 'sync_dispatch_rejected',
    ]);
    const code = error instanceof Error && allowedCodes.has(error.message) ? error.message : 'sync_failed';
    process.stderr.write(`${code}\n`);
    if (code === 'sync_dispatch_token_missing') {
      process.stderr.write('Configure source Actions secret TEACHER_SYNC_DISPATCH_TOKEN with target-only Actions write permission.\n');
    }
    process.exitCode = 1;
  });
}
