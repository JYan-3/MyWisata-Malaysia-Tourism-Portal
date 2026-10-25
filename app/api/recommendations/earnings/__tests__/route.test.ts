import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  getRecommendationEarnings: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser } })),
}));
vi.mock('@/lib/recommendations/earnings', () => ({
  getRecommendationEarnings: mocks.getRecommendationEarnings,
}));

import { GET } from '../route';

const userId = '11111111-1111-4111-8111-111111111111';

describe('GET /api/recommendations/earnings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('401s when signed out', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const response = await GET(new Request('http://localhost/api/recommendations/earnings'));
    expect(response.status).toBe(401);
    expect(mocks.getRecommendationEarnings).not.toHaveBeenCalled();
  });

  it('returns the earnings payload for the signed-in user', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: userId } } });
    const payload = {
      totals: { pending: 12.5, lifetimeCleared: 18, convertedVendors: 2 },
      commissions: [{ id: 'c1' }],
      totalCount: 1,
      pageSize: 25,
      hasMore: false,
      nextCursor: null,
    };
    mocks.getRecommendationEarnings.mockResolvedValue(payload);

    const response = await GET(new Request('http://localhost/api/recommendations/earnings?pageSize=25&recommendationId=22222222-2222-4222-8222-222222222222&beforeCreatedAt=2026-03-04T00%3A00%3A00.000Z&beforeId=33333333-3333-4333-8333-333333333333'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: payload });
    expect(mocks.getRecommendationEarnings).toHaveBeenCalledWith(expect.anything(), {
      recommendationId: '22222222-2222-4222-8222-222222222222',
      snapshotCutoff: undefined,
      pageSize: 25,
      cursor: { createdAt: '2026-03-04T00:00:00.000Z', id: '33333333-3333-4333-8333-333333333333' },
    });
  });

  it('rejects invalid pagination and filter values before querying', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: userId } } });
    const response = await GET(new Request('http://localhost/api/recommendations/earnings?pageSize=500&recommendationId=not-a-uuid'));
    expect(response.status).toBe(400);
    expect(mocks.getRecommendationEarnings).not.toHaveBeenCalled();
  });
});
