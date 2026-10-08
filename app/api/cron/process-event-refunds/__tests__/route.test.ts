import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const serviceDb = { kind: 'service-db' };
const mocks = vi.hoisted(() => ({
  createServiceClient: vi.fn(),
  processQueuedEventRefunds: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({ createServiceClient: mocks.createServiceClient }));
vi.mock('@/lib/refunds/process-queued-event-refunds', () => ({
  processQueuedEventRefunds: mocks.processQueuedEventRefunds,
}));

import { GET } from '../route';

function request(authorization?: string) {
  return new Request('http://localhost/api/cron/process-event-refunds', {
    headers: authorization ? { authorization } : undefined,
  });
}

describe('GET /api/cron/process-event-refunds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CRON_SECRET', 'cron_test_secret');
    mocks.createServiceClient.mockReturnValue(serviceDb);
    mocks.processQueuedEventRefunds.mockResolvedValue({ processed: 3, handedToAdmin: 1, error: null });
  });

  afterEach(() => vi.unstubAllEnvs());

  it('fails closed when cron authentication is not configured', async () => {
    vi.stubEnv('CRON_SECRET', '');

    const response = await GET(request('Bearer cron_test_secret'));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'cron_not_configured' });
    expect(mocks.processQueuedEventRefunds).not.toHaveBeenCalled();
  });

  it.each([undefined, 'Bearer wrong_secret'])('rejects missing or invalid cron authorization', async (authorization) => {
    const response = await GET(request(authorization));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
    expect(mocks.processQueuedEventRefunds).not.toHaveBeenCalled();
  });

  it('runs the queue processor with the service client and reports its counts', async () => {
    const response = await GET(request('Bearer cron_test_secret'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ processed: 3, handedToAdmin: 1 });
    expect(mocks.createServiceClient).toHaveBeenCalledOnce();
    expect(mocks.processQueuedEventRefunds).toHaveBeenCalledWith(serviceDb);
  });

  it('reports a processing failure without returning partial counts', async () => {
    mocks.processQueuedEventRefunds.mockResolvedValue({ processed: 2, handedToAdmin: 1, error: 'rpc_failed' });

    const response = await GET(request('Bearer cron_test_secret'));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'event_refunds_failed' });
  });
});
