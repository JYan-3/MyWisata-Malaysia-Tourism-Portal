import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  resolveServerCustomerCapability: vi.fn(),
  getAffiliateEarningsPage: vi.fn(),
  createServiceClient: vi.fn(() => ({ service: true })),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser } })) }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: mocks.createServiceClient }));
vi.mock('@/lib/auth/customer-capabilities.server', () => ({
  resolveServerCustomerCapability: mocks.resolveServerCustomerCapability,
  customerCapabilityFailure: vi.fn(() => null),
}));
vi.mock('@/lib/affiliate/earnings-history', () => ({ getAffiliateEarningsPage: mocks.getAffiliateEarningsPage }));

import { GET } from '../route';

describe('GET /api/affiliate/earnings-history', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mocks.resolveServerCustomerCapability.mockResolvedValue({ allowed: true });
    mocks.getAffiliateEarningsPage.mockResolvedValue({ totalCount: 0, commissions: [] });
  });

  it('passes the authenticated owner, range, page size, snapshot and keyset cursor', async () => {
    const response = await GET(new Request('http://localhost/api/affiliate/earnings-history?range=month&pageSize=25&snapshotCutoff=2026-10-25T00%3A00%3A00.000Z&beforeCreatedAt=2026-10-01T00%3A00%3A00.000Z&beforeId=11111111-1111-4111-8111-111111111111'));
    expect(response.status).toBe(200);
    expect(mocks.getAffiliateEarningsPage).toHaveBeenCalledWith(expect.anything(), 'user-1', {
      range: 'month', pageSize: 25,
      snapshotCutoff: '2026-10-25T00:00:00.000Z',
      cursor: { createdAt: '2026-10-01T00:00:00.000Z', id: '11111111-1111-4111-8111-111111111111' },
    });
  });

  it('rejects invalid size and incomplete cursors', async () => {
    const response = await GET(new Request('http://localhost/api/affiliate/earnings-history?pageSize=500&beforeId=not-a-uuid'));
    expect(response.status).toBe(400);
    expect(mocks.getAffiliateEarningsPage).not.toHaveBeenCalled();
  });

  it('does not expose another user query before authentication', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const response = await GET(new Request('http://localhost/api/affiliate/earnings-history'));
    expect(response.status).toBe(401);
    expect(mocks.getAffiliateEarningsPage).not.toHaveBeenCalled();
  });
});
