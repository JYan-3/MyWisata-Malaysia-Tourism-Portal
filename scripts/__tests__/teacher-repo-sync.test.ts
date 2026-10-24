import { describe, expect, it, vi } from 'vitest';
import { requestTeacherSync, sourceCiTriggerSha, verifySourceMainCi } from '../teacher-repo-sync.mjs';

const source = 'TanZhengYang0912/MyWisata-Malaysia-Tourism-Portal';
const target = 'JYan-3/MyWisata-Malaysia-Tourism-Portal';
const sha = 'a'.repeat(40);
const newerSha = 'b'.repeat(40);
const approvedRun = {
  name: 'CI', path: '.github/workflows/ci.yml', event: 'push', head_branch: 'main',
  head_sha: sha, status: 'completed', conclusion: 'success',
  head_repository: { full_name: source },
};
const event = { action: 'completed', repository: { full_name: source }, workflow_run: approvedRun };

function publicReads(run: Record<string, unknown> = approvedRun, currentSha = sha) {
  return vi.fn()
    .mockResolvedValueOnce(Response.json({ object: { sha: currentSha } }))
    .mockResolvedValueOnce(Response.json({ workflow_runs: [run] }));
}

describe('source main CI verification', () => {
  it('requires the exact current main SHA and a successful push CI run', async () => {
    const request = publicReads();
    await expect(verifySourceMainCi(sha, request)).resolves.toEqual({ ready: true, sha });
    expect(String(request.mock.calls[0][0])).toBe(`https://api.github.com/repos/${source}/git/ref/heads/main`);
    const query = new URL(String(request.mock.calls[1][0]));
    expect(query.pathname).toBe(`/repos/${source}/actions/workflows/ci.yml/runs`);
    expect(query.searchParams.get('head_sha')).toBe(sha);
    expect(query.searchParams.get('branch')).toBe('main');
    expect(query.searchParams.get('event')).toBe('push');
    for (const [, options] of request.mock.calls) {
      expect(options).toMatchObject({ redirect: 'error' });
      expect(new Headers(options.headers).has('authorization')).toBe(false);
    }
  });

  it('skips a stale source SHA without checking or triggering another commit', async () => {
    const request = publicReads(approvedRun, newerSha);
    await expect(verifySourceMainCi(sha, request)).resolves.toEqual({ ready: false, reason: 'source_main_advanced' });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each(['bad', '', '../main', `${sha}\n`, 'a'.repeat(41)])('rejects malformed commit input %j before HTTP', async (value) => {
    const request = vi.fn();
    await expect(verifySourceMainCi(value, request)).rejects.toThrow('source_sha_invalid');
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    { status: 'in_progress', conclusion: null },
    { status: 'queued', conclusion: null },
    { status: 'completed', conclusion: 'failure' },
    { status: 'completed', conclusion: 'cancelled' },
    { status: 'completed', conclusion: 'skipped' },
  ])('never accepts pending or unsuccessful CI %j', async (change) => {
    const request = publicReads({ ...approvedRun, ...change });
    expect((await verifySourceMainCi(sha, request)).ready).toBe(false);
  });

  it.each([
    { head_sha: newerSha }, { head_branch: 'feature/test' }, { event: 'pull_request' },
    { name: 'Other workflow' }, { path: '.github/workflows/other.yml' },
  ])('rejects an API run that is not the required CI %j', async (change) => {
    await expect(verifySourceMainCi(sha, publicReads({ ...approvedRun, ...change }))).rejects.toThrow('source_ci_response_invalid');
  });

  it('does not authorize a source commit with no CI run', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(Response.json({ object: { sha } }))
      .mockResolvedValueOnce(Response.json({ workflow_runs: [] }));
    expect((await verifySourceMainCi(sha, request)).ready).toBe(false);
  });

  it('fails closed on malformed or unavailable API responses', async () => {
    await expect(verifySourceMainCi(sha, vi.fn().mockResolvedValue(Response.json({ object: {} })))).rejects.toThrow('source_ci_response_invalid');
    await expect(verifySourceMainCi(sha, vi.fn().mockResolvedValue(new Response('private body', { status: 403 })))).rejects.toThrow('source_ci_unavailable');
  });
});

describe('teacher synchronization request', () => {
  it('recognizes only the trusted successful source main push event', () => {
    expect(sourceCiTriggerSha(event)).toBe(sha);
    expect(sourceCiTriggerSha(null)).toBeNull();
    expect(sourceCiTriggerSha({ ...event, action: 'requested' })).toBeNull();
    expect(sourceCiTriggerSha({ ...event, repository: { full_name: target } })).toBeNull();
  });

  it.each([
    { head_branch: 'feature/test' }, { event: 'pull_request' }, { conclusion: 'failure' },
    { status: 'in_progress' }, { name: 'Other workflow' }, { path: '.github/workflows/other.yml' },
    { head_repository: { full_name: 'untrusted/fork' } }, { head_sha: 'invalid' },
  ])('ignores ineligible events before using credentials or HTTP %j', async (change) => {
    const request = vi.fn();
    expect((await requestTeacherSync({ ...event, workflow_run: { ...approvedRun, ...change } }, 'private-token', request)).requested).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it('requires a dedicated token without silently falling back to another credential', async () => {
    const request = vi.fn();
    await expect(requestTeacherSync(event, '', request)).rejects.toThrow('sync_dispatch_token_missing');
    expect(request).not.toHaveBeenCalled();
  });

  it.each([200, 204])('requests the fixed target workflow, ref and verified SHA (HTTP %i)', async (status) => {
    const request = publicReads().mockResolvedValueOnce(new Response(null, { status }));
    await expect(requestTeacherSync(event, 'private-token', request)).resolves.toEqual({ requested: true, sha });
    const [url, options] = request.mock.calls[2];
    expect(String(url)).toBe(`https://api.github.com/repos/${target}/actions/workflows/sync-teacher-main.yml/dispatches`);
    expect(options).toMatchObject({ method: 'POST', redirect: 'error' });
    expect(new Headers(options.headers).get('authorization')).toBe('Bearer private-token');
    expect(JSON.parse(String(options.body))).toEqual({ ref: 'main', inputs: { source_sha: sha } });
    expect(String(url)).not.toContain('private-token');
  });

  it('does not dispatch a stale or unverified source main', async () => {
    const stale = publicReads(approvedRun, newerSha);
    expect((await requestTeacherSync(event, 'private-token', stale)).requested).toBe(false);
    expect(stale).toHaveBeenCalledTimes(1);
    const failed = publicReads({ ...approvedRun, conclusion: 'failure' });
    expect((await requestTeacherSync(event, 'private-token', failed)).requested).toBe(false);
    expect(failed).toHaveBeenCalledTimes(2);
  });

  it('sanitizes API failures instead of exposing response bodies or credentials', async () => {
    const rejected = publicReads().mockResolvedValueOnce(new Response('private-token confidential response', { status: 403 }));
    await expect(requestTeacherSync(event, 'private-token', rejected)).rejects.toThrow(/^sync_dispatch_rejected$/);
    const network = publicReads().mockRejectedValueOnce(new Error('private-token in transport diagnostics'));
    await expect(requestTeacherSync(event, 'private-token', network)).rejects.toThrow(/^sync_dispatch_unavailable$/);
  });
});
