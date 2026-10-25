import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const mocks = vi.hoisted(() => ({
  getClearanceDays: vi.fn(), getTierForUser: vi.fn(), resolveProductNames: vi.fn(), createServiceClient: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('../settings', () => ({ getClearanceDays: mocks.getClearanceDays }));
vi.mock('../tier', () => ({ getTierForUser: mocks.getTierForUser }));
vi.mock('../product-names', () => ({ resolveProductNames: mocks.resolveProductNames }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: mocks.createServiceClient }));

const { getAffiliateStats } = await import('../stats');

function summary(overrides: Record<string, unknown> = {}) {
  return {
    affiliateCode: 'AF-TEST01',
    totals: { clicks: 4012, referrals: 4, pendingEarnings: 10, availableToWithdraw: 30, totalEarnings: 30 },
    byProduct: [{ productId: 'p1', shares: 2, clicks: 5, referrals: 1, earnings: 10, reversedReferrals: 2 }],
    byCampaign: [{ campaign: null, clicks: 5, referrals: 1, earnings: 10 }],
    clicksByDay: [{ date: '2026-09-01', clicks: 5 }],
    funnel: { shares: 2, clicks: 5, conversions: 1, shareToClickRate: 2.5, clickToConversionRate: 0.2, sourceTrackingActive: false, byPlatform: [] },
    commissions: [{ id: 'c1', productId: 'p1', targetType: 'product', orderAmount: '100', rate: '0.03', amount: '10', status: 'pending', createdAt: '2026-09-01T00:00:00Z', clearedAt: null }],
    ...overrides,
  };
}

describe('getAffiliateStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockResolvedValue({ data: summary(), error: null });
    mocks.getClearanceDays.mockResolvedValue(7);
    mocks.getTierForUser.mockResolvedValue({ tierName: 'standard', rate: 0.03, referralCount: 0, nextTier: null, referralsToNext: null });
    mocks.resolveProductNames.mockResolvedValue(new Map([['p1', 'Product One']]));
    mocks.createServiceClient.mockReturnValue({ service: true });
  });

  it('uses SQL full-history totals/groups and resolves only grouped and preview product names', async () => {
    const stats = await getAffiliateStats({ rpc: mocks.rpc } as unknown as SupabaseClient, 'user-1');
    expect(mocks.rpc).toHaveBeenCalledWith('get_my_affiliate_dashboard_summary');
    expect(stats.totals).toMatchObject({ clicks: 4012, totalEarnings: 30, availableToWithdraw: 30 });
    expect(stats.byProduct[0]).toMatchObject({ productId: 'p1', productName: 'Product One', referrals: 1, reversedReferrals: 2 });
    expect(stats.commissions).toHaveLength(1);
  });

  it('does not return fabricated zero totals when the summary query fails', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'timeout' } });
    await expect(getAffiliateStats({ rpc: mocks.rpc } as unknown as SupabaseClient, 'user-1'))
      .rejects.toThrow('affiliate_dashboard_unavailable');
  });
});
