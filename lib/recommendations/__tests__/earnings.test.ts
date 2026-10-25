import { describe, expect, it, vi } from 'vitest';
import { getRecommendationEarnings } from '@/lib/recommendations/earnings';

function serviceFor(data: unknown, error: unknown = null) {
  const rpc = vi.fn(async () => ({ data, error }));
  return { service: { rpc } as never, rpc };
}

const result = {
  totals: { pending: 12.5, lifetimeCleared: 18, convertedVendors: 2 },
  totalCount: 3,
  pageSize: 10 as const,
  hasMore: false,
  nextCursor: null,
  snapshotCutoff: '2026-03-10T00:00:00.000Z',
  commissions: [
    { id: 'a', conversionId: 'conv-a', commissionType: 'bonus', amount: 12.5, commissionRate: null, status: 'pending', holdUntil: '2026-03-15T00:00:00.000Z', createdAt: '2026-03-05T00:00:00.000Z', recommendationId: 'rec-1', vendorName: 'Aunty Lim Kitchen' },
    { id: 'b', conversionId: 'conv-b', commissionType: 'ongoing', amount: 18, commissionRate: 0.03, status: 'confirmed', holdUntil: null, createdAt: '2026-03-04T00:00:00.000Z', recommendationId: 'rec-1', vendorName: 'Aunty Lim Kitchen' },
  ],
};

describe('getRecommendationEarnings', () => {
  it('returns database totals independently from the bounded commission page', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-10T00:00:00.000Z'));
    const { service, rpc } = serviceFor(result);
    const response = await getRecommendationEarnings(service);

    expect(rpc).toHaveBeenCalledWith('get_recommendation_earnings_page', {
      p_recommendation_id: null,
      p_snapshot_cutoff: '2026-03-10T00:00:00.000Z',
      p_page_size: 10,
      p_before_created_at: null,
      p_before_id: null,
    });
    expect(response.totals).toEqual(result.totals);
    expect(response.totalCount).toBe(3);
    expect(response.commissions).toHaveLength(2);
    expect(response.commissions[0]).toMatchObject({ vendorName: 'Aunty Lim Kitchen', recommendationId: 'rec-1', type: 'bonus', amount: 12.5, clearsInDays: 5 });
    vi.useRealTimers();
  });

  it('passes recommendation filter, page size and stable keyset cursor to SQL', async () => {
    const { service, rpc } = serviceFor(result);
    await getRecommendationEarnings(service, {
      recommendationId: 'rec-1', pageSize: 25,
      snapshotCutoff: '2026-03-10T00:00:00.000Z',
      cursor: { createdAt: '2026-03-04T00:00:00.000Z', id: 'b' },
    });
    expect(rpc).toHaveBeenCalledWith('get_recommendation_earnings_page', {
      p_recommendation_id: 'rec-1', p_snapshot_cutoff: '2026-03-10T00:00:00.000Z', p_page_size: 25,
      p_before_created_at: '2026-03-04T00:00:00.000Z', p_before_id: 'b',
    });
  });

  it('fails closed instead of showing a database failure as zero earnings', async () => {
    const { service } = serviceFor(null, { message: 'boom' });
    await expect(getRecommendationEarnings(service)).rejects.toThrow('recommendation_earnings_unavailable');
  });
});
