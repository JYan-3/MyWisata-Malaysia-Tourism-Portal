import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ process: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: vi.fn(() => ({})) }));
vi.mock('@/lib/orders/paid-order-effects', () => ({ processPaidOrders: mocks.process }));

import { GET } from '../route';

const call = (auth?: string) => GET(new Request('http://localhost/api/cron/process-paid-orders', { headers: auth ? { authorization: auth } : {} }));

describe('/api/cron/process-paid-orders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'test-secret';
    mocks.process.mockResolvedValue({ processed: 3, failed: 1 });
  });

  it('refuses callers without the cron secret', async () => {
    expect((await call()).status).toBe(401);
    expect((await call('Bearer wrong')).status).toBe(401);
    expect(mocks.process).not.toHaveBeenCalled();
  });

  it('processes waiting paid orders and reports the counts', async () => {
    const response = await call('Bearer test-secret');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ processed: 3, failed: 1 });
  });

  it('reports the job as unavailable instead of crashing when the database fails', async () => {
    mocks.process.mockRejectedValue(new Error('db down'));
    expect((await call('Bearer test-secret')).status).toBe(503);
  });
});
