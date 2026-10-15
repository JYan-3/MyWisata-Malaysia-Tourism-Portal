import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ rpc }) }));

vi.mock('@/lib/events/operational-job', () => ({ runEventOperationalJob: async (_service: unknown, _job: unknown, execute: () => Promise<unknown>) => execute() }));

import { GET } from '../route';

describe('GET /api/cron/expire-checkout-sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CRON_SECRET', 'cron-test-secret');
    rpc.mockImplementation(async (name: string) => ({ data: name === 'expire_checkout_sessions' ? 3 : { opened: 2, closed: 1 }, error: null }));
  });

  it('fails closed when the cron secret is missing or invalid', async () => {
    vi.stubEnv('CRON_SECRET', '');
    expect((await GET(new Request('http://localhost/api/cron/expire-checkout-sessions'))).status).toBe(503);
    vi.stubEnv('CRON_SECRET', 'cron-test-secret');
    expect((await GET(new Request('http://localhost/api/cron/expire-checkout-sessions', {
      headers: { authorization: 'Bearer wrong' },
    }))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('expires abandoned checkout sessions only after cron authorization', async () => {
    const response = await GET(new Request('http://localhost/api/cron/expire-checkout-sessions', {
      headers: { authorization: 'Bearer cron-test-secret' },
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ expired: 3, pickupsOpened: 2, pickupsClosed: 1 });
    expect(rpc).toHaveBeenNthCalledWith(1, 'expire_checkout_sessions');
    expect(rpc).toHaveBeenNthCalledWith(2, 'refresh_overdue_event_pickups');
  });

  it('does not report success when expiration fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'database unavailable' } });
    const response = await GET(new Request('http://localhost/api/cron/expire-checkout-sessions', {
      headers: { authorization: 'Bearer cron-test-secret' },
    }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'checkout_expiration_failed' });
  });
  it('reports pickup discovery failure without claiming success or exposing database details', async () => {
    rpc.mockResolvedValueOnce({ data: 3, error: null }).mockResolvedValueOnce({ data: null, error: { message: 'private database details' } });
    const response = await GET(new Request('http://localhost/api/cron/expire-checkout-sessions', {
      headers: { authorization: 'Bearer cron-test-secret' },
    }));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'pickup_discovery_failed' });
  });

});

it('does not report a healthy sweep when overdue discovery fails', async () => {
 rpc.mockResolvedValueOnce({data:3,error:null}).mockResolvedValueOnce({data:null,error:{message:'unavailable'}});
 expect((await GET(new Request('http://localhost',{headers:{authorization:'Bearer cron-test-secret'}}))).status).toBe(500);
});
