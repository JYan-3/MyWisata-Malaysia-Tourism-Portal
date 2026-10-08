import { beforeEach, describe, expect, it, vi } from 'vitest';
const process = vi.hoisted(() => vi.fn());
vi.mock('@/lib/email/outbox', () => ({ processEmailOutbox: process }));
import { GET } from '@/app/api/cron/process-email-outbox/route';
describe('scheduled durable mail processing', () => {
  beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('CRON_SECRET', 'fixture-cron'); });
  it('does not process mail without the configured secret', async () => {
    expect((await GET(new Request('http://localhost/cron'))).status).toBe(401);
    vi.stubEnv('CRON_SECRET', '');
    expect((await GET(new Request('http://localhost/cron', { headers: { authorization: 'Bearer ' } }))).status).toBe(401);
    expect(process).not.toHaveBeenCalled();
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
});
