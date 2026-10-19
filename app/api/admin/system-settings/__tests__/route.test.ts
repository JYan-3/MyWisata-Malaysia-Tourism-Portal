import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ guard: vi.fn(), in: vi.fn(), maybeSingle: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/staff-permissions/server', () => ({ requireStaffRoleManagementSuperAdmin: mocks.guard }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({
  from: vi.fn((table: string) => table === 'users'
    ? { select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: mocks.maybeSingle })) })) }
    : { select: vi.fn(() => ({ in: mocks.in })) }),
  rpc: mocks.rpc,
}) }));

import { GET, PATCH } from '../route';

function patchRequest(body: unknown) {
  return new Request('http://localhost/api/admin/system-settings', {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('/api/admin/system-settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.guard.mockResolvedValue({ user: { id: 'super-admin-1' }, response: null });
    mocks.in.mockResolvedValue({ data: [
      { key: 'operations.pause_new_orders', value: 'true', updated_at: '2026-10-15T05:00:00Z', updated_by: 'super-admin-1' },
      { key: 'email.pause_custom_delivery', value: 'false', updated_at: '2026-10-15T05:00:00Z', updated_by: 'super-admin-1' },
    ], error: null });
    mocks.maybeSingle.mockResolvedValue({ data: { full_name: 'Platform Admin' }, error: null });
    mocks.rpc.mockResolvedValue({ data: '2026-10-15T05:00:00Z', error: null });
  });

  it('restricts reads to the global Super Admin guard and exposes only two settings', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ pauseNewOrders: true, pauseCustomDelivery: false, updatedBy: 'Platform Admin' });
    expect(mocks.guard).toHaveBeenCalledOnce();
  });

  it('rejects writes before calling the service RPC when the guard fails', async () => {
    mocks.guard.mockResolvedValue({ user: null, response: Response.json({}, { status: 403 }) });
    expect((await PATCH(patchRequest({ pauseNewOrders: true, pauseCustomDelivery: false, reason: 'planned maintenance' }))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('writes both switches and the audit reason atomically through the service-only RPC', async () => {
    const response = await PATCH(patchRequest({ pauseNewOrders: true, pauseCustomDelivery: true, reason: 'incident containment' }));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('set_platform_operations_settings', {
      p_pause_new_orders: true, p_pause_custom_delivery: true, p_actor_id: 'super-admin-1', p_reason: 'incident containment',
    });
  });

  it('rejects non-boolean fields and short reasons', async () => {
    expect((await PATCH(patchRequest({ pauseNewOrders: 'true', pauseCustomDelivery: false, reason: 'short' }))).status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('does not report success if database audit update fails', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: new Error('atomic write failed') });
    expect((await PATCH(patchRequest({ pauseNewOrders: false, pauseCustomDelivery: true, reason: 'temporary mail pause' }))).status).toBe(500);
  });
});
