import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireStaffPermission = vi.fn();
vi.mock('@/lib/staff-permissions/server', () => ({ requireStaffPermission }));

const maybeSingle = vi.fn();
const from = vi.fn();
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ from }) }));

const { GET, PATCH } = await import('../route');

const promotionId = 'promo-1';
function params() { return { params: Promise.resolve({ id: promotionId }) }; }

const row = {
  id: promotionId, vendor_id: 'vendor-1', title: 'Penang Food Fair', details: 'd',
  starts_on: '2027-01-15', ends_on: '2027-01-17', poster_url: 'https://x/p.png', status: 'pending',
  rejection_reason: null, changes_requested_reason: null,
  amount_sen: null, payment_method: null, paid_at: null, created_at: '2027-01-01T00:00:00.000Z',
  vendors: { name: 'Vendor One' },
};

function reviewRequest(body: unknown) {
  return new Request('http://localhost/api/admin/event-promotions/promo-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/admin/event-promotions/[id]', () => {
  let rpc: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    rpc = vi.fn().mockResolvedValue({ error: null });
    requireStaffPermission.mockResolvedValue({ db: { rpc }, user: { id: 'admin-1' }, response: null });
    maybeSingle.mockResolvedValue({ data: row, error: null });
    from.mockReturnValue({ select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle });
  });

  describe('GET', () => {
    it('requires admin.event_promotion.review before reading', async () => {
      requireStaffPermission.mockResolvedValue({
        db: { rpc }, user: null,
        response: Response.json({ data: null, error: { code: 'FORBIDDEN' } }, { status: 403 }),
      });
      const response = await GET(new Request('http://localhost'), params());
      expect(response.status).toBe(403);
      expect(from).not.toHaveBeenCalled();
    });

    it('returns the promotion with the vendor name flattened in', async () => {
      const response = await GET(new Request('http://localhost'), params());
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.data.promotion).toMatchObject({ id: promotionId, vendorName: 'Vendor One' });
    });

    it('returns 404 when the row does not exist', async () => {
      maybeSingle.mockResolvedValue({ data: null, error: null });
      const response = await GET(new Request('http://localhost'), params());
      expect(response.status).toBe(404);
    });
  });

  describe('PATCH', () => {
    it('approves without requiring a note', async () => {
      const response = await PATCH(reviewRequest({ action: 'approve' }), params());
      expect(response.status).toBe(200);
      expect(rpc).toHaveBeenCalledWith('review_vendor_event_promotion', {
        p_promotion_id: promotionId, p_action: 'approve', p_note: null,
      });
    });

    it('rejects a reject/request_changes action with no note before calling the RPC', async () => {
      const response = await PATCH(reviewRequest({ action: 'reject' }), params());
      expect(response.status).toBe(422);
      expect(rpc).not.toHaveBeenCalled();
    });

    it('passes the note through for request_changes', async () => {
      const response = await PATCH(reviewRequest({ action: 'request_changes', note: 'Please add a clearer poster image.' }), params());
      expect(response.status).toBe(200);
      expect(rpc).toHaveBeenCalledWith('review_vendor_event_promotion', {
        p_promotion_id: promotionId, p_action: 'request_changes', p_note: 'Please add a clearer poster image.',
      });
    });

    it('maps a not_pending RPC error to 409', async () => {
      rpc.mockResolvedValue({ error: { message: 'not_pending' } });
      const response = await PATCH(reviewRequest({ action: 'approve' }), params());
      expect(response.status).toBe(409);
    });

    it('maps a not_found RPC error to 404', async () => {
      rpc.mockResolvedValue({ error: { message: 'not_found' } });
      const response = await PATCH(reviewRequest({ action: 'approve' }), params());
      expect(response.status).toBe(404);
    });

    it('requires admin.event_promotion.review before reviewing', async () => {
      requireStaffPermission.mockResolvedValue({
        db: { rpc }, user: null,
        response: Response.json({ data: null, error: { code: 'FORBIDDEN' } }, { status: 403 }),
      });
      const response = await PATCH(reviewRequest({ action: 'approve' }), params());
      expect(response.status).toBe(403);
      expect(rpc).not.toHaveBeenCalled();
    });
  });
});
