import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createServiceClient: vi.fn(),
  isSuperAdmin: vi.fn(),
  getAdminAffiliateAttributionPage: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: mocks.createServiceClient }));
vi.mock('@/lib/affiliate/admin-guard', () => ({ isSuperAdmin: mocks.isSuperAdmin }));
vi.mock('@/lib/affiliate/admin-stats', () => ({ getAdminAffiliateAttributionPage: mocks.getAdminAffiliateAttributionPage }));

import { GET } from '@/app/api/admin/affiliate/attributions/route';

describe('admin affiliate attributions route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: 'admin-1' } } }) } });
    mocks.createServiceClient.mockReturnValue({ service: true });
    mocks.isSuperAdmin.mockResolvedValue(true);
    mocks.getAdminAffiliateAttributionPage.mockResolvedValue({ items: [{ id: 'row-1' }], totalCount: 31,
      pageSize: 10, hasMore: true, snapshotCutoff: '2026-10-25T00:00:00.000Z', nextCursor: null });
  });

  it('passes validated filters and cursor to the database-backed page query', async () => {
    const cursor = { sortValue: 'alex', createdAt: '2026-10-20T00:00:00Z', id: '11111111-1111-4111-8111-111111111111' };
    const response = await GET(new Request(`https://example.test/api/admin/affiliate/attributions?status=pending&search=alex&sortKey=userName&sortDir=asc&cursor=${encodeURIComponent(JSON.stringify(cursor))}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.getAdminAffiliateAttributionPage).toHaveBeenCalledWith({ service: true }, expect.objectContaining({
      status: 'pending', search: 'alex', sortKey: 'userName', sortDir: 'asc', pageSize: 10, cursor,
    }));
    expect(body.data).toMatchObject({ totalCount: 31, pageSize: 10, hasMore: true });
  });

  it('rejects unsupported page sizes and future snapshots before querying', async () => {
    const response = await GET(new Request('https://example.test/api/admin/affiliate/attributions?pageSize=11'));
    expect(response.status).toBe(422);
    expect(mocks.getAdminAffiliateAttributionPage).not.toHaveBeenCalled();
  });

  it('fails closed if the bounded database page fails', async () => {
    mocks.getAdminAffiliateAttributionPage.mockRejectedValue(new Error('database unavailable'));
    const response = await GET(new Request('https://example.test/api/admin/affiliate/attributions'));
    expect(response.status).toBe(503);
  });
});
