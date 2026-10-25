import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getAffiliateEarningsExportPages: vi.fn(),
  resolveServerCustomerCapability: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/affiliate/earnings-export', () => ({
  getAffiliateEarningsExportPages: mocks.getAffiliateEarningsExportPages,
}));
vi.mock('@/lib/auth/customer-capabilities.server', () => ({
  customerCapabilityFailure: () => null,
  resolveServerCustomerCapability: mocks.resolveServerCustomerCapability,
}));

const { GET } = await import('../route');

async function* pages() {
  yield [{
    date: '2026-10-24T12:00:00.000Z',
    productName: 'Synthetic product',
    orderReference: 'ORD-1',
    orderAmount: 10,
    commissionRate: 0.03,
    commissionAmount: 0.3,
    status: 'confirmed' as const,
    clearedAt: '2026-10-25T12:00:00.000Z',
  }];
  yield [{
    date: '2026-10-23T12:00:00.000Z',
    productName: 'Second batch',
    orderReference: 'ORD-2',
    orderAmount: null,
    commissionRate: 0.04,
    commissionAmount: 0.4,
    status: 'pending' as const,
    clearedAt: null,
  }];
}

describe('GET /api/affiliate/earnings-export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: 'owner-1' } } }) } });
    mocks.resolveServerCustomerCapability.mockResolvedValue({ allowed: true });
    mocks.getAffiliateEarningsExportPages.mockImplementation(pages);
  });

  it('streams CSV batches with one header and no lost rows', async () => {
    const response = await GET(new Request('https://example.test/api/affiliate/earnings-export?range=all'));
    const csv = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(csv.match(/Date,Activity/g)).toHaveLength(1);
    expect(csv).toContain('ORD-1');
    expect(csv).toContain('ORD-2');
  });

  it('returns a clear 413 before starting the stream when the row budget is exceeded', async () => {
    mocks.getAffiliateEarningsExportPages.mockImplementation(async function* () {
      throw new Error('affiliate_earnings_export_limit_exceeded');
    });

    const response = await GET(new Request('https://example.test/api/affiliate/earnings-export?range=all'));

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: 'EXPORT_LIMIT_EXCEEDED' } });
  });
});
