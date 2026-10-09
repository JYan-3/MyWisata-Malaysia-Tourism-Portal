import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ requireStaffPermission: vi.fn(), isSuperAdmin: vi.fn(), upsert: vi.fn(), insert: vi.fn() }));

vi.mock('@/lib/staff-permissions/server', () => ({ requireStaffPermission: mocks.requireStaffPermission }));
vi.mock('@/lib/affiliate/admin-guard', () => ({ isSuperAdmin: mocks.isSuperAdmin }));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn(() => {
      const chain: Record<string, unknown> = {
        upsert: mocks.upsert,
        insert: mocks.insert,
        select: vi.fn(() => chain),
        order: vi.fn(async () => ({ data: [], error: null })),
        delete: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
      };
      return chain;
    }),
  })),
}));

import { PUT } from '../route';

const tier = (rank: number, minSalesSen: number) => ({ rank, name: `Tier ${rank}`, feeType: 'fixed', percentRate: null, fixedPerItemSen: 100, minSalesSen });
const put = (body: unknown) => PUT(new Request('http://localhost/api/admin/vendor-fee-tiers', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
const valid = { tiers: [tier(1, 0), tier(2, 1_000_000), tier(3, 5_000_000)], eventDefaultPerItemSen: 100, campaignFees: [], reason: 'Launch fixed per-item pricing' };

describe('PUT /api/admin/vendor-fee-tiers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireStaffPermission.mockResolvedValue({ db: {}, user: { id: 'admin-1' }, response: null });
    mocks.isSuperAdmin.mockResolvedValue(true);
    mocks.upsert.mockResolvedValue({ error: null });
    mocks.insert.mockResolvedValue({ error: null });
  });

  it('only lets a Super Admin change fees', async () => {
    mocks.isSuperAdmin.mockResolvedValue(false);
    expect((await put(valid)).status).toBe(403);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('rejects tiers whose sales thresholds do not rise', async () => {
    expect((await put({ ...valid, tiers: [tier(1, 0), tier(2, 5_000_000), tier(3, 1_000_000)] })).status).toBe(422);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('saves all three tiers and writes an audit row', async () => {
    expect((await put(valid)).status).toBe(200);
    expect(mocks.upsert).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ rank: 1, fee_type: 'fixed', fixed_per_item_sen: 100, percent_rate: null })]), { onConflict: 'rank' });
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ action: 'vendor.platform_fees_updated', note: valid.reason }));
  });
});
