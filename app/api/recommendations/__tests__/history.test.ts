import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ from: vi.fn(), select: vi.fn(), eq: vi.fn(), order: vi.fn(), range: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'customer-1' } } }) }, from: mocks.from }) }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: vi.fn() }));
import { GET } from '../route';
beforeEach(() => {
  vi.clearAllMocks();
  const query = { select: mocks.select, eq: mocks.eq, order: mocks.order, range: mocks.range };
  mocks.from.mockReturnValue(query); mocks.select.mockReturnValue(query); mocks.eq.mockReturnValue(query); mocks.order.mockReturnValue(query);
  mocks.range.mockResolvedValue({ data: [], count: 38, error: null });
});
it('pushes ownership, filter, stable ordering, page size and filtered total to the database', async () => {
  const response = await GET(new Request('http://localhost/api/recommendations?page=2&status=pending'));
  expect(response.status).toBe(200);
  expect(mocks.eq).toHaveBeenCalledWith('recommender_id', 'customer-1');
  expect(mocks.eq).toHaveBeenCalledWith('status', 'pending');
  expect(mocks.order).toHaveBeenCalledWith('id', { ascending: false });
  expect(mocks.range).toHaveBeenCalledWith(25, 49);
  expect(await response.json()).toMatchObject({ data: { items: [], total: 38, page: 2, pageSize: 25, totalPages: 2 } });
});
it('rejects invalid page and status before querying', async () => {
  for (const suffix of ['page=1.5', 'page=0', 'page=999999', 'status=made-up']) {
    expect((await GET(new Request(`http://localhost/api/recommendations?${suffix}`))).status).toBe(422);
  }
  expect(mocks.from).not.toHaveBeenCalled();
});
