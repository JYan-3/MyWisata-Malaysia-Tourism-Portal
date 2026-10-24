import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), remove: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ rpc: mocks.rpc, storage: { from: () => ({ remove: mocks.remove }) } }) }));
import { purgeStagedRecommendationImages } from '../staged-cleanup';
const id = '00000000-0000-4000-8000-000000000001';
beforeEach(() => { vi.clearAllMocks(); mocks.rpc.mockResolvedValue({ data: [{ id, storage_path: `${id}/staged/${id}.jpg` }], error: null }); mocks.remove.mockResolvedValue({ error: null }); });
it('never confirms database deletion after a Storage failure', async () => {
  mocks.remove.mockResolvedValue({ error: true });
  await expect(purgeStagedRecommendationImages()).rejects.toThrow('staged_storage_unavailable');
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
});
it('keeps storage paths private and confirms only a successful batch', async () => {
  mocks.rpc.mockResolvedValueOnce({ data: [{ id, storage_path: `${id}/staged/${id}.jpg` }], error: null }).mockResolvedValueOnce({ data: 1, error: null });
  expect(await purgeStagedRecommendationImages()).toEqual({ claimed: 1, purged: 1 });
  expect(mocks.rpc).toHaveBeenLastCalledWith('finish_staged_recommendation_cleanup', { p_ids: [id] });
});
