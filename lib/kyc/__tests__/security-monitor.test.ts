import { beforeEach, describe, expect, it, vi } from 'vitest';
const { rpc, service } = vi.hoisted(() => ({ rpc: vi.fn(), service: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: service }));
const { startKycPurgeRun, finishKycPurgeRun, checkKycSecurityHealth } = await import('../security-monitor');
const db = { rpc };
const id = '11111111-1111-4111-8111-111111111111';
describe('KYC durable job lifecycle', () => {
  beforeEach(() => { vi.resetAllMocks(); service.mockReturnValue(db); });
  it('requires a valid durable run id before any deletions', async () => {
    rpc.mockResolvedValueOnce({ data: id, error: null });
    expect(await startKycPurgeRun(db as never)).toBe(id);
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(startKycPurgeRun(db as never)).rejects.toThrow('purge_record_unavailable');
  });
  it('finishes empty successful runs and propagates persistence failures without private error text', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await finishKycPurgeRun(db as never, id, { claimed: 0, purged: 0, failed: 0, failureCode: null });
    expect(rpc).toHaveBeenCalledWith('finish_kyc_purge_run', { p_run_id: id, p_claimed: 0, p_purged: 0, p_failed: 0, p_failure_code: null });
    rpc.mockResolvedValueOnce({ data: null, error: new Error('private storage path') });
    await expect(finishKycPurgeRun(db as never, id, { claimed: 1, purged: 0, failed: 1, failureCode: 'storage_failed' })).rejects.toThrow('purge_record_unavailable');
  });
  it('treats an invalid monitor response as failure', async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(checkKycSecurityHealth()).rejects.toThrow('kyc_monitor_unavailable');
    rpc.mockResolvedValue({ data: { checked: true }, error: null });
    await expect(checkKycSecurityHealth()).resolves.toBeUndefined();
  });
});
