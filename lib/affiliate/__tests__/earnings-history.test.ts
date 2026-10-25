import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getClearanceDays: vi.fn(), resolveProductNames: vi.fn() }));
vi.mock('../settings', () => ({ getClearanceDays: mocks.getClearanceDays }));
vi.mock('../product-names', () => ({ resolveProductNames: mocks.resolveProductNames }));

const { getAffiliateEarningsPage } = await import('../earnings-history');

describe('getAffiliateEarningsPage', () => {
  it('uses bounded SQL page, owner scope and fixed snapshot; totals come from the full filtered set', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        snapshotCutoff: '2026-10-25T00:00:00.000Z', totalCount: 41,
        pageSize: 10, hasMore: true, nextCursor: { createdAt: '2026-10-01T00:00:00.000Z', id: 'cursor-id' },
        pendingAmount: 15, totalAmount: 90,
        commissions: [{ id: 'c1', targetType: 'product', targetId: 'product-1', displayId: 'ORD-1', orderAmount: '20.00', rate: '0.03', amount: '0.60', status: 'pending', createdAt: '2026-10-02T00:00:00.000Z', clearedAt: null }],
      }, error: null,
    });
    mocks.getClearanceDays.mockResolvedValue(7);
    mocks.resolveProductNames.mockResolvedValue(new Map([['product-1', 'Synthetic product']]));

    const result = await getAffiliateEarningsPage({ rpc } as never, 'owner-1', {
      range: 'all', pageSize: 10, snapshotCutoff: '2026-10-25T00:00:00.000Z',
      cursor: { createdAt: '2026-10-03T00:00:00.000Z', id: 'previous-id' },
    });

    expect(rpc).toHaveBeenCalledWith('get_affiliate_earnings_page', {
      p_user_id: 'owner-1', p_since: null, p_snapshot_cutoff: '2026-10-25T00:00:00.000Z',
      p_page_size: 10, p_before_created_at: '2026-10-03T00:00:00.000Z', p_before_id: 'previous-id',
    });
    expect(result.totalCount).toBe(41);
    expect(result.pendingAmount).toBe(15);
    expect(result.commissions[0]).toMatchObject({ productName: 'Synthetic product', orderAmount: 20, amount: 0.6, status: 'pending' });
  });

  it('fails closed on query errors', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'database unavailable' } });
    await expect(getAffiliateEarningsPage({ rpc } as never, 'owner-1', { range: 'all', pageSize: 10 }))
      .rejects.toThrow('affiliate_earnings_history_unavailable');
  });
});
