import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createServiceClient: vi.fn(),
  isSuperAdmin: vi.fn(),
  getAffiliateAdminStats: vi.fn(),
  getFinancialOperationsHealth: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: mocks.createServiceClient }));
vi.mock('@/lib/affiliate/admin-guard', () => ({ isSuperAdmin: mocks.isSuperAdmin }));
vi.mock('@/lib/affiliate/admin-stats', () => ({ getAffiliateAdminStats: mocks.getAffiliateAdminStats }));
vi.mock('@/lib/operations/queue-health', () => ({ getFinancialOperationsHealth: mocks.getFinancialOperationsHealth }));

import { GET } from '@/app/api/admin/affiliate/stats/route';

describe('admin affiliate stats route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: 'admin-1' } } }) } });
    mocks.createServiceClient.mockReturnValue({ service: true });
    mocks.isSuperAdmin.mockResolvedValue(true);
    mocks.getAffiliateAdminStats.mockResolvedValue({ totals: { totalAffiliates: 1 } });
    mocks.getFinancialOperationsHealth.mockResolvedValue({ availability: 'partial' });
  });

  it('returns service statistics to an authenticated Super Admin', async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.getAffiliateAdminStats).toHaveBeenCalledWith({ service: true });
    expect(body.data.totals.totalAffiliates).toBe(1);
  });

  it('returns unavailable instead of successful zero statistics when an aggregate fails', async () => {
    mocks.getAffiliateAdminStats.mockRejectedValue(new Error('database unavailable'));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.code).toBe('UNAVAILABLE');
    expect(mocks.getFinancialOperationsHealth).not.toHaveBeenCalled();
  });
});
