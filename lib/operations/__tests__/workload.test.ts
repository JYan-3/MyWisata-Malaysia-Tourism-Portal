import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ rpc: mocks.rpc }) }));
import { withPortalWorkload } from '../workload';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockImplementation((name: string) => ({ abortSignal: async () => ({ data: name === 'claim_portal_workload', error: null }) }));
});
describe('shared workload admission', () => {
  it('does not run rejected or unverifiable work', async () => {
    const work = vi.fn();
    mocks.rpc.mockReturnValue({ abortSignal: async () => ({ data: false, error: null }) });
    await expect(withPortalWorkload('kyc_upload', work)).rejects.toMatchObject({ code: 'busy' });
    mocks.rpc.mockReturnValue({ abortSignal: async () => ({ data: null, error: true }) });
    await expect(withPortalWorkload('kyc_upload', work)).rejects.toMatchObject({ code: 'unavailable' });
    expect(work).not.toHaveBeenCalled();
  });
  it('holds the local slot until actual work settles and fences release by token', async () => {
    let finish!: () => void;
    const work = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const first = withPortalWorkload('kyc_upload', work);
    await vi.waitFor(() => expect(work).toHaveBeenCalledOnce());
    await expect(withPortalWorkload('kyc_upload', vi.fn())).rejects.toMatchObject({ code: 'busy' });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    finish(); await first;
    expect(mocks.rpc.mock.calls[1][1]).toEqual(mocks.rpc.mock.calls[0][1]);
    await expect(withPortalWorkload('kyc_upload', async () => 42)).resolves.toBe(42);
  });
  it('releases after a thrown work error', async () => {
    await expect(withPortalWorkload('trip_ai', async () => { throw new Error('failed'); })).rejects.toThrow('failed');
    expect(mocks.rpc).toHaveBeenLastCalledWith('release_portal_workload', expect.anything());
  });
});
