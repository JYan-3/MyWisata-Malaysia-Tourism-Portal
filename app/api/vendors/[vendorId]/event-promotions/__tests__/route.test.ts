import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ authorizeVendor: vi.fn() }));
vi.mock('@/lib/vendor-authorization', () => ({ authorizeVendor: mocks.authorizeVendor }));

import { GET, POST } from '../route';

const vendorId = 'vendor-1';
function params() { return { params: Promise.resolve({ vendorId }) }; }

function jsonRequest(body: unknown) {
  return new Request('http://localhost/api/vendors/vendor-1/event-promotions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validSubmission = {
  title: 'Penang Food Fair',
  details: 'Our stall will be at the Penang Food Fair this weekend.',
  startDate: '2027-01-15',
  endDate: '2027-01-17',
  posterUrl: 'https://storage.example/event-posters/vendor-1/poster.png',
};

describe('/api/vendors/[vendorId]/event-promotions', () => {
  let select: ReturnType<typeof vi.fn>;
  let eq: ReturnType<typeof vi.fn>;
  let order: ReturnType<typeof vi.fn>;
  let maybeSingle: ReturnType<typeof vi.fn>;
  let insertSingle: ReturnType<typeof vi.fn>;
  let from: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    maybeSingle = vi.fn().mockResolvedValue({ data: { status: 'approved' }, error: null });
    order = vi.fn().mockResolvedValue({ data: [], error: null });
    insertSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'promo-1', vendor_id: vendorId, title: validSubmission.title, details: validSubmission.details,
        starts_on: validSubmission.startDate, ends_on: validSubmission.endDate, poster_url: validSubmission.posterUrl, status: 'pending',
        rejection_reason: null, changes_requested_reason: null,
        amount_sen: null, payment_method: null, paid_at: null,
        created_at: '2027-01-01T00:00:00.000Z', updated_at: '2027-01-01T00:00:00.000Z',
      },
      error: null,
    });
    eq = vi.fn().mockReturnThis();
    select = vi.fn().mockReturnThis();
    const query = {
      select,
      eq,
      order,
      maybeSingle,
      insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: insertSingle }) }),
    };
    from = vi.fn(() => query);
    mocks.authorizeVendor.mockResolvedValue({
      ok: true,
      access: { userId: 'user-1', vendorId, serviceDb: { from } },
    });
  });

  describe('GET', () => {
    it('lists the vendor\'s own promotions after authorization', async () => {
      const response = await GET(new Request('http://localhost'), params());
      expect(response.status).toBe(200);
      expect(mocks.authorizeVendor).toHaveBeenCalledWith(vendorId);
      expect(from).toHaveBeenCalledWith('vendor_event_promotions');
    });

    it('propagates an authorization failure', async () => {
      mocks.authorizeVendor.mockResolvedValue({ ok: false, response: Response.json({ error: { code: 'FORBIDDEN' } }, { status: 403 }) });
      const response = await GET(new Request('http://localhost'), params());
      expect(response.status).toBe(403);
      expect(from).not.toHaveBeenCalled();
    });
  });

  describe('POST', () => {
    it('submits a new event promotion for an approved vendor', async () => {
      const response = await POST(jsonRequest(validSubmission), params());
      const body = await response.json();
      expect(response.status).toBe(201);
      expect(body.data.promotion.status).toBe('pending');
      expect(insertSingle).toHaveBeenCalled();
    });

    it('rejects submission when the vendor is not approved', async () => {
      maybeSingle.mockResolvedValueOnce({ data: { status: 'pending' }, error: null });
      const response = await POST(jsonRequest(validSubmission), params());
      expect(response.status).toBe(403);
      expect(insertSingle).not.toHaveBeenCalled();
    });

    it('rejects an invalid payload before touching the database', async () => {
      const response = await POST(jsonRequest({ ...validSubmission, title: 'ab' }), params());
      expect(response.status).toBe(422);
      expect(insertSingle).not.toHaveBeenCalled();
    });
  });
});
