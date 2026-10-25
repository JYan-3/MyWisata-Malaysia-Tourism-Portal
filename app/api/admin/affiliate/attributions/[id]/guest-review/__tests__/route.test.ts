import { describe, expect, it, vi, beforeEach } from 'vitest';

const getUser = vi.fn();
const createClient = vi.fn();
vi.mock('@/lib/supabase/server', () => ({ createClient }));

const createServiceClient = vi.fn();
vi.mock('@/lib/supabase/service', () => ({ createServiceClient }));

const isSuperAdmin = vi.fn();
vi.mock('@/lib/affiliate/admin-guard', () => ({ isSuperAdmin }));

const resolveGuestCommissionReview = vi.fn();
vi.mock('@/lib/affiliate/clearing', () => ({ resolveGuestCommissionReview }));

const { POST } = await import('../route');
const ATTRIBUTION_ID = '11111111-1111-4111-8111-111111111111';

function request(body: unknown = { action: 'release', version: 1 }) {
  return new Request(`http://localhost/api/admin/affiliate/attributions/${ATTRIBUTION_ID}/guest-review`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

function call(body?: unknown) {
  return POST(request(body), { params: Promise.resolve({ id: ATTRIBUTION_ID }) });
}

describe('POST /api/admin/affiliate/attributions/[id]/guest-review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: 'admin-1' } } });
    createClient.mockResolvedValue({ auth: { getUser } });
    createServiceClient.mockReturnValue({});
  });

  it('requires super admin and validates a versioned decision', async () => {
    isSuperAdmin.mockResolvedValue(false);
    expect((await call()).status).toBe(403);
    expect(resolveGuestCommissionReview).not.toHaveBeenCalled();
    isSuperAdmin.mockResolvedValue(true);
    expect((await call({ action: 'release', version: 0 })).status).toBe(422);
    expect(resolveGuestCommissionReview).not.toHaveBeenCalled();
  });

  it('passes the expected version and reports stale concurrent decisions', async () => {
    isSuperAdmin.mockResolvedValue(true);
    resolveGuestCommissionReview.mockResolvedValue({ outcome: 'stale' });
    const response = await call({ action: 'release', version: 3 });
    expect(response.status).toBe(409);
    expect(resolveGuestCommissionReview).toHaveBeenCalledWith({}, ATTRIBUTION_ID, 3, 'release', 'admin-1');
  });

  it('returns the committed review decision', async () => {
    isSuperAdmin.mockResolvedValue(true);
    resolveGuestCommissionReview.mockResolvedValue({ outcome: 'resolved', decision: 'reject', version: 2 });
    const response = await call({ action: 'reject', version: 1 });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { id: ATTRIBUTION_ID, status: 'reject', version: 2 } });
  });
});
