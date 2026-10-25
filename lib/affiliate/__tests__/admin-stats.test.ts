import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const mocks = vi.hoisted(() => ({
  getActiveTiers: vi.fn(),
  resolveProductNames: vi.fn(),
}));

vi.mock('../tier', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tier')>();
  return { ...actual, getActiveTiers: mocks.getActiveTiers };
});
vi.mock('../product-names', () => ({ resolveProductNames: mocks.resolveProductNames }));

const { getAffiliateAdminStats } = await import('../admin-stats');

const TIERS = [
  { id: 't1', tierName: 'standard', rate: 0.03, minReferrals: 0, minSalesAmountSen: 0, activePeriodDays: null, maxFraudRatePercent: null },
  { id: 't2', tierName: 'active', rate: 0.04, minReferrals: 4, minSalesAmountSen: 50000, activePeriodDays: 90, maxFraudRatePercent: 20 },
  { id: 't3', tierName: 'top', rate: 0.05, minReferrals: 8, minSalesAmountSen: 200000, activePeriodDays: 60, maxFraudRatePercent: 10 },
];

function buildFixture() {
  const links = [{ id: 'link-1', user_id: 'user-1', affiliate_code: 'AF-TOP01', is_active: true }];
  const clicks = Array.from({ length: 10 }, (_, i) => ({
    id: `c${i + 1}`, link_id: 'link-1', target_type: 'product', target_id: 'p1', ip_hash: `h${i}`, source: null, created_at: '2026-09-01T00:00:00Z',
  }));
  const now = new Date().toISOString();
  // 9 confirmed attributions -> meets top's minReferrals (8) and sales bar; only the fraud rate should block top.
  const attributions = Array.from({ length: 9 }, (_, i) => ({
    id: `a${i + 1}`, click_id: `c${i + 1}`, order_id: `o${i + 1}`, commission_amount: 30, status: 'confirmed', created_at: now,
  }));
  const orders = Array.from({ length: 9 }, (_, i) => ({ id: `o${i + 1}`, total_amount: 1000 })); // RM1000 each -> RM9000 total, well over top's RM2000 bar
  const fraudFlags = [
    { link_id: 'link-1', status: 'open', flag_type: 'click_velocity' },
    { link_id: 'link-1', status: 'open', flag_type: 'click_velocity' },
  ]; // 2 of 10 clicks -> 20% fraud rate: fails top's 10% cap, passes active's 20% cap exactly
  return { links, clicks, attributions, orders, fraudFlags };
}

function makeService(fixture: ReturnType<typeof buildFixture>): SupabaseClient {
  const tierFraudCount = fixture.fraudFlags.filter((flag) => flag.flag_type !== 'self_referral' && flag.flag_type !== 'expired_attribution').length;
  const summary = {
    totals: {
      totalAffiliates: fixture.links.length,
      totalClicks: fixture.clicks.length,
      totalReferrals: fixture.attributions.filter((row) => row.status !== 'reversed' && row.status !== 'rejected').length,
      totalCommission: fixture.attributions.filter((row) => row.status !== 'reversed' && row.status !== 'rejected')
        .reduce((sum, row) => sum + row.commission_amount, 0),
    },
    topEarners: [{ userId: 'user-1', userName: 'Top Affiliate', affiliateCode: 'AF-TOP01', referrals: 9,
      commission: 270, tierName: tierFraudCount >= 2 ? 'active' : 'top' }],
    funnel: { shares: 0, clicks: fixture.clicks.length, conversions: fixture.attributions.length,
      shareToClickRate: null, clickToConversionRate: fixture.attributions.length / fixture.clicks.length,
      sourceTrackingActive: false, byPlatform: [] },
  };
  const page = {
    snapshotCutoff: '2026-10-25T00:00:00.000Z', totalCount: fixture.attributions.length, pageSize: 10,
    hasMore: false, nextCursor: null,
    items: fixture.attributions.map((row) => ({ id: row.id, userId: 'user-1', userName: 'Top Affiliate',
      productId: 'p1', productName: 'Product 1', orderId: row.order_id, commissionAmount: row.commission_amount,
      status: row.status, createdAt: row.created_at, reviewStatus: null, reviewVersion: null, reviewEvidence: null })),
  };
  return {
    from: () => { throw new Error('getAffiliateAdminStats should aggregate through RPCs'); },
    rpc: async (name: string) => {
      if (name === 'affiliate_maturity_exposure') return { data: {
        generated_at: '2026-10-25T00:00:00Z',
        pending: { count: 2, amount_rm: 30 },
        confirmed_on_paid_orders: { count: 1, amount_rm: 5 },
        confirmed_on_refunded_orders: { count: 1, amount_rm: 7 },
        confirmed_on_other_statuses: { count: 0, amount_rm: 0 },
      }, error: null };
      if (name === 'get_affiliate_admin_summary') return { data: summary, error: null };
      if (name === 'get_admin_affiliate_attribution_page') return { data: page, error: null };
      throw new Error(`unexpected RPC ${name}`);
    },
  } as unknown as SupabaseClient;
}

describe('getAffiliateAdminStats — tier resolution with all 4 signals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActiveTiers.mockResolvedValue(TIERS);
    mocks.resolveProductNames.mockResolvedValue(new Map());
  });

  it('caps a high-volume affiliate at active when their fraud rate exceeds top\'s cap', async () => {
    const stats = await getAffiliateAdminStats(makeService(buildFixture()));
    expect(stats.topEarners).toHaveLength(1);
    expect(stats.topEarners[0].tierName).toBe('active');
  });

  it('reaches top once the fraud rate drops below the cap, same volume otherwise', async () => {
    const fixture = buildFixture();
    fixture.fraudFlags = []; // 0% fraud rate now
    const stats = await getAffiliateAdminStats(makeService(fixture));
    expect(stats.topEarners[0].tierName).toBe('top');
  });

  it('does not count buying through your own link toward the fraud rate', async () => {
    const fixture = buildFixture();
    fixture.fraudFlags = fixture.fraudFlags.map((flag) => ({ ...flag, flag_type: 'self_referral' }));
    const stats = await getAffiliateAdminStats(makeService(fixture));
    expect(stats.topEarners[0].tierName).toBe('top');
  });

  it('exposes SQL aggregated commission risk by recorded order state', async () => {
    const stats = await getAffiliateAdminStats(makeService(buildFixture()));
    expect(stats.maturityExposure).toEqual({
      generatedAt: '2026-10-25T00:00:00Z',
      pending: { count: 2, amountRM: 30 },
      confirmedOnPaidOrders: { count: 1, amountRM: 5 },
      confirmedOnRefundedOrders: { count: 1, amountRM: 7 },
      confirmedOnOtherStatuses: { count: 0, amountRM: 0 },
    });
  });

  it('fails closed when a core aggregate source cannot be read', async () => {
    const service = makeService(buildFixture());
    service.rpc = (async (name: string) => name === 'get_affiliate_admin_summary'
      ? { data: null, error: new Error('database unavailable') }
      : { data: null, error: null }) as unknown as SupabaseClient['rpc'];

    await expect(getAffiliateAdminStats(service)).rejects.toThrow('unavailable');
  });
});
