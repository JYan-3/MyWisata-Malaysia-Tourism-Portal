import { beforeEach, describe, expect, it, vi } from 'vitest';

const worker = vi.hoisted(() => ({ process: vi.fn() }));
vi.mock('@/lib/content-translations/worker', () => ({ processContentTranslationJobs: worker.process }));
import { GET } from '../route';

describe('GET /api/cron/process-content-translation-jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CRON_SECRET', 'test-cron-secret');
    worker.process.mockResolvedValue({ claimed: 2, completed: 1, deferred: 1, superseded: 0 });
  });

  it('requires the configured cron bearer token', async () => {
    const response = await GET(new Request('https://app.test/api/cron/process-content-translation-jobs'));
    expect(response.status).toBe(401);
    expect(worker.process).not.toHaveBeenCalled();
  });

  it('runs a bounded batch and returns only aggregate counters', async () => {
    const response = await GET(new Request('https://app.test/api/cron/process-content-translation-jobs', {
      headers: { authorization: 'Bearer test-cron-secret' },
    }));
    expect(response.status).toBe(200);
    expect(worker.process).toHaveBeenCalledWith(4);
    expect(await response.json()).toEqual({ claimed: 2, completed: 1, deferred: 1, superseded: 0 });
  });
});
