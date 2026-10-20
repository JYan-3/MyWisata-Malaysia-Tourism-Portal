import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), gate: vi.fn(), service: vi.fn() }));
vi.mock('@/lib/kyc/reviewer-auth', () => ({ requireKycReviewer: mocks.gate }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: mocks.service }));
import { GET } from '../route';

const request = (query = '') => new Request(`http://localhost/api/admin/kyc/submissions${query}`);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.gate.mockResolvedValue({ db: { rpc: mocks.rpc }, user: { id: 'reviewer' }, response: null });
  const query = { select: vi.fn(), in: vi.fn(), eq: vi.fn(), order: vi.fn(),
    then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null, count: 0 }) };
  for (const method of [query.select, query.in, query.eq, query.order]) method.mockReturnValue(query);
  mocks.service.mockReturnValue({ from: () => query });
  mocks.rpc.mockResolvedValue({ data: { submissions: [], customers: [], total: 10000, page: 2,
    pageSize: 25, totalPages: 400, counts: { pending: 9990, infoRequested: 10 }, verifiedCount: 12 }, error: null });
});

describe('bounded KYC review queue', () => {
  it('denies a failed MFA/permission gate before reading cases', async () => {
    mocks.gate.mockResolvedValue({ response: new Response(null, { status: 403 }) });
    expect((await GET(request())).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.service).not.toHaveBeenCalled();
  });
  it('uses the authenticated database for bounded filters and full filtered count', async () => {
    const response = await GET(request('?page=2&pageSize=25&status=pending&assignment=mine&search=Aina'));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('get_kyc_review_queue', {
      p_page: 2, p_page_size: 25, p_status: 'pending', p_assignment: 'mine', p_search: 'Aina',
    });
    expect((await response.json()).data).toMatchObject({ total: 10000, totalPages: 400 });
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(mocks.service).not.toHaveBeenCalled();
  });
  it.each(['?pageSize=10000', '?page=0', '?assignment=someone-else', '?status=approved', '?search=' + 'a'.repeat(201)])(
    'rejects invalid filters %s without querying cases', async (query) => {
      expect((await GET(request(query))).status).toBe(422);
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );
  it('does not turn database failure into a zero backlog or leak database messages', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'private/internal/path' } });
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private/internal/path');
  });
});
