import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireStaffPermission = vi.fn();
vi.mock('@/lib/staff-permissions/server', () => ({ requireStaffPermission }));

const from = vi.fn();
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ from }) }));

const { GET } = await import('../route');

const rows = [
  { id: 'promo-1', vendor_id: 'vendor-1', title: 'Penang Food Fair', details: 'd', starts_on: '2027-01-15', ends_on: '2027-01-17', poster_url: 'https://x/p.png', status: 'pending', rejection_reason: null, changes_requested_reason: null, amount_sen: null, payment_method: null, paid_at: null, created_at: '2027-01-01T00:00:00.000Z', vendors: { name: 'Vendor One' } },
];

describe('GET /api/admin/event-promotions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireStaffPermission.mockResolvedValue({ db: {}, user: { id: 'admin-1' }, response: null });
    const query = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn(() => Promise.resolve({ data: rows, error: null })),
      eq: vi.fn().mockReturnThis(),
    };
    from.mockReturnValue(query);
  });

  it('requires admin.event_promotion.review before reading', async () => {
    requireStaffPermission.mockResolvedValue({
      db: {},
      user: null,
      response: Response.json({ data: null, error: { code: 'FORBIDDEN' } }, { status: 403 }),
    });
    const response = await GET(new Request('http://localhost/api/admin/event-promotions'));
    expect(response.status).toBe(403);
    expect(requireStaffPermission).toHaveBeenCalledWith('admin.event_promotion.review');
    expect(from).not.toHaveBeenCalled();
  });

  it('lists promotions with the vendor name flattened in', async () => {
    const response = await GET(new Request('http://localhost/api/admin/event-promotions'));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.promotions[0]).toMatchObject({ id: 'promo-1', vendorName: 'Vendor One', status: 'pending' });
  });
});
