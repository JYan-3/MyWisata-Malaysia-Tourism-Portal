import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ gate: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/kyc/reviewer-auth', () => ({ requireKycReviewer: mocks.gate }));
import { POST } from '../route';
beforeEach(() => {
  mocks.gate.mockResolvedValue({ db: { rpc: mocks.rpc }, response: null });
  mocks.rpc.mockReset().mockResolvedValue({ data: { submissionId: null }, error: null });
});
const request = (body: unknown) => new Request('http://localhost', { method: 'POST', body: JSON.stringify(body) });
describe('KYC case navigation', () => {
  it('checks reviewer before parsing or accessing assignments', async () => {
    mocks.gate.mockResolvedValue({ response: new Response(null, { status: 403 }) });
    expect((await POST(request({ action: 'next' }))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('uses only the authenticated database actor for atomic next-case', async () => {
    const response = await POST(request({ action: 'next' }));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('manage_kyc_review_work', { p_action: 'next', p_submission_id: null, p_expected_version: null, p_session_id: null });
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it.each([{ action: 'release' }, { action: 'next', actorId: 'forged' }, { action: 'approve' }])('rejects invalid assignment input %j', async (body) => {
    expect((await POST(request(body))).status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('does not leak diagnostics on claim conflict', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'private path secret' } });
    const response = await POST(request({ action: 'next' }));
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain('secret');
  });
});
