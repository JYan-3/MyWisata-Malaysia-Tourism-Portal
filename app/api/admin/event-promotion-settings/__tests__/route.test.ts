import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireStaffPermission: vi.fn(),
  getUser: vi.fn(),
  getEventPromotionCostPerDaySen: vi.fn(),
  setEventPromotionCostPerDaySen: vi.fn(),
  getEventPromotionMaxConcurrent: vi.fn(),
  setEventPromotionMaxConcurrent: vi.fn(),
}));

vi.mock('@/lib/staff-permissions/server', () => ({ requireStaffPermission: mocks.requireStaffPermission }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser } })) }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: vi.fn(() => ({})) }));
vi.mock('@/lib/admin/event-promotions', () => ({
  getEventPromotionCostPerDaySen: mocks.getEventPromotionCostPerDaySen,
  setEventPromotionCostPerDaySen: mocks.setEventPromotionCostPerDaySen,
  getEventPromotionMaxConcurrent: mocks.getEventPromotionMaxConcurrent,
  setEventPromotionMaxConcurrent: mocks.setEventPromotionMaxConcurrent,
}));

import { GET, PATCH } from '../route';

function patchRequest(body: unknown) {
  return new Request('http://localhost/api/admin/event-promotion-settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/admin/event-promotion-settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getEventPromotionCostPerDaySen.mockResolvedValue(10_000);
    mocks.setEventPromotionCostPerDaySen.mockResolvedValue(undefined);
    mocks.getEventPromotionMaxConcurrent.mockResolvedValue(4);
    mocks.setEventPromotionMaxConcurrent.mockResolvedValue(undefined);
  });

  describe('GET', () => {
    it('is readable by any signed-in user, not just staff', async () => {
      mocks.getUser.mockResolvedValue({ data: { user: { id: 'vendor-user-1' } } });
      const response = await GET();
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.data).toEqual({ costPerDaySen: 10_000, maxConcurrent: 4 });
      expect(mocks.requireStaffPermission).not.toHaveBeenCalled();
    });

    it('rejects a signed-out request', async () => {
      mocks.getUser.mockResolvedValue({ data: { user: null } });
      const response = await GET();
      expect(response.status).toBe(401);
    });
  });

  describe('PATCH', () => {
    it('requires admin.event_promotion.review before writing', async () => {
      mocks.requireStaffPermission.mockResolvedValue({
        user: null,
        response: Response.json({ data: null, error: { code: 'FORBIDDEN' } }, { status: 403 }),
      });
      const response = await PATCH(patchRequest({ costPerDaySen: 15_000 }));
      expect(response.status).toBe(403);
      expect(mocks.requireStaffPermission).toHaveBeenCalledWith('admin.event_promotion.review');
      expect(mocks.setEventPromotionCostPerDaySen).not.toHaveBeenCalled();
    });

    it('updates the rate for a staff member with permission', async () => {
      mocks.requireStaffPermission.mockResolvedValue({ user: { id: 'admin-1' }, response: null });
      const response = await PATCH(patchRequest({ costPerDaySen: 15_000 }));
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.data).toEqual({ costPerDaySen: 15_000 });
      expect(mocks.setEventPromotionCostPerDaySen).toHaveBeenCalledWith({}, 15_000, 'admin-1');
    });

    it('rejects a negative rate before writing', async () => {
      mocks.requireStaffPermission.mockResolvedValue({ user: { id: 'admin-1' }, response: null });
      const response = await PATCH(patchRequest({ costPerDaySen: -1 }));
      expect(response.status).toBe(422);
      expect(mocks.setEventPromotionCostPerDaySen).not.toHaveBeenCalled();
    });

    it('updates the concurrency cap independently of the rate', async () => {
      mocks.requireStaffPermission.mockResolvedValue({ user: { id: 'admin-1' }, response: null });
      const response = await PATCH(patchRequest({ maxConcurrent: 6 }));
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.data).toEqual({ maxConcurrent: 6 });
      expect(mocks.setEventPromotionMaxConcurrent).toHaveBeenCalledWith({}, 6, 'admin-1');
      expect(mocks.setEventPromotionCostPerDaySen).not.toHaveBeenCalled();
    });

    it('rejects a body with neither field before writing', async () => {
      mocks.requireStaffPermission.mockResolvedValue({ user: { id: 'admin-1' }, response: null });
      const response = await PATCH(patchRequest({}));
      expect(response.status).toBe(422);
      expect(mocks.setEventPromotionCostPerDaySen).not.toHaveBeenCalled();
      expect(mocks.setEventPromotionMaxConcurrent).not.toHaveBeenCalled();
    });
  });
});
