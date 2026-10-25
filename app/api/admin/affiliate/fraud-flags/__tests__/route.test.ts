import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createServiceClient: vi.fn(),
  isSuperAdmin: vi.fn(),
  getFraudFlagPage: vi.fn(),
  getFraudCounters: vi.fn(),
  getDisabledLinks: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: mocks.createServiceClient }));
vi.mock('@/lib/affiliate/admin-guard', () => ({ isSuperAdmin: mocks.isSuperAdmin }));
vi.mock('@/lib/affiliate/fraud', () => ({
  getFraudFlagPage: mocks.getFraudFlagPage,
  getFraudCounters: mocks.getFraudCounters,
  getDisabledLinks: mocks.getDisabledLinks,
}));

import { GET } from '@/app/api/admin/affiliate/fraud-flags/route';

describe('admin affiliate fraud flags route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: 'admin-1' } } }) } });
    mocks.createServiceClient.mockReturnValue({ service: true });
    mocks.isSuperAdmin.mockResolvedValue(true);
    mocks.getFraudFlagPage.mockResolvedValue({ items: [{ id: 'flag-1' }], total: 21, page: 2, pageSize: 10 });
    mocks.getFraudCounters.mockResolvedValue({ openFlags: 21 });
    mocks.getDisabledLinks.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10 });
  });

  it('applies validated database filters and returns the filtered count for the requested page', async () => {
    const response = await GET(new Request('https://example.test/api/admin/affiliate/fraud-flags?page=2&pageSize=10&type=click_velocity&severity=high&status=open&search=abc'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.getFraudFlagPage).toHaveBeenCalledWith({ service: true }, {
      page: 2,
      pageSize: 10,
      flagType: 'click_velocity',
      severity: 'high',
      status: 'open',
      search: 'abc',
    });
    expect(body.data).toMatchObject({ flags: [{ id: 'flag-1' }], total: 21, page: 2, pageSize: 10 });
  });

  it('rejects unsupported page sizes before querying the database', async () => {
    const response = await GET(new Request('https://example.test/api/admin/affiliate/fraud-flags?pageSize=11'));
    expect(response.status).toBe(422);
    expect(mocks.getFraudFlagPage).not.toHaveBeenCalled();
  });
});
