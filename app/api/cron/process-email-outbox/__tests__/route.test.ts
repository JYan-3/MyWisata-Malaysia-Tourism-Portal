import { beforeEach, describe, expect, it, vi } from 'vitest';
const process = vi.hoisted(() => vi.fn());
const monitor = vi.hoisted(() => vi.fn());
vi.mock('@/lib/email/outbox', () => ({ processEmailOutbox: process }));
vi.mock('@/lib/kyc/security-monitor', () => ({ checkKycSecurityHealth: monitor }));
vi.mock('@/lib/operations/queue-health', () => ({ recordPortalDispatch: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/wallet/approver-notifications', () => ({ processWithdrawalApproverNotifications: vi.fn().mockResolvedValue({ recipients: 0 }) }));
import { GET } from '@/app/api/cron/process-email-outbox/route';
describe('scheduled durable mail processing', () => {
  beforeEach(() => { vi.resetAllMocks(); monitor.mockResolvedValue(undefined); vi.stubEnv('CRON_SECRET', 'fixture-cron'); });
  it('does not process mail without the configured secret', async () => {
    expect((await GET(new Request('http://localhost/cron'))).status).toBe(401);
    vi.stubEnv('CRON_SECRET', '');
    expect((await GET(new Request('http://localhost/cron', { headers: { authorization: 'Bearer ' } }))).status).toBe(401);
    expect(process).not.toHaveBeenCalled();
    expect(monitor).not.toHaveBeenCalled();
  });
  it('processes a bounded batch and keeps errors private', async () => {
    const request = () => new Request('http://localhost/cron', { headers: { authorization: 'Bearer fixture-cron' } });
    process.mockResolvedValueOnce({ sent: 1, failed: 1 });
    expect(await (await GET(request())).json()).toEqual({ sent: 1, failed: 1 });
    expect(process).toHaveBeenCalledWith(20);
    process.mockRejectedValueOnce(new Error('private database details'));
    const failure = await GET(request());
    expect(failure.status).toBe(503);
    expect(await failure.text()).not.toContain('private database');
  });
  it('continues processing ordinary mail when security monitoring fails, but reports failure', async () => {
    monitor.mockRejectedValue(new Error('private details'));
    process.mockResolvedValue({ sent: 1, failed: 0 });
    const response = await GET(new Request('http://localhost/cron', { headers: { authorization: 'Bearer fixture-cron' } }));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private details');
    expect(process).toHaveBeenCalledWith(20);
  });
  it('keeps ambiguous or exhausted delivery visible as an operational failure', async () => {
    process.mockResolvedValue({ sent: 0, failed: 0, reviewRequired: 2 });
    const response = await GET(new Request('http://localhost/cron', { headers: { authorization: 'Bearer fixture-cron' } }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ sent: 0, failed: 0, reviewRequired: 2, error: 'email_delivery_review_required' });
  });
});
