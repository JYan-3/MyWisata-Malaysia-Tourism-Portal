import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ permission: vi.fn(), rpc: vi.fn(), mail: vi.fn() }));
vi.mock('@/lib/staff-permissions/server', () => ({ requireStaffPermission: mocks.permission }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: vi.fn() }));
vi.mock('@/lib/email/outbox', () => ({ processEmailOutbox: mocks.mail }));
import { PATCH } from '../route';
const id = '11111111-1111-4111-8111-111111111111';
const expectedUpdatedAt = '2026-10-08T00:00:00Z';
const context = { params: Promise.resolve({ id }) };
const request = (body: unknown) => new Request('http://localhost/test', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
describe('confirmed event booth approval', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.permission.mockResolvedValue({ user: { id: 'admin' }, db: { rpc: mocks.rpc }, response: null });
    mocks.rpc.mockResolvedValue({ data: { notificationQueued: true }, error: null });
  });
  it('passes the explicit confirmed booth and version to the protected RPC', async () => {
    expect((await PATCH(request({ action: 'approve', stallNumber: ' A12 ', expectedUpdatedAt }), context)).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('review_campaign_vendor_registration_with_stall', {
      p_registration_id: id, p_action: 'approve', p_note: null, p_expected_updated_at: expectedUpdatedAt, p_stall_number: 'A12',
    });
    expect(mocks.mail).toHaveBeenCalledWith(20);
  });
  it('returns safe capacity/booth errors and does not send mail for a rolled-back approval', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'event_stall_conflict secret-internal-id' } });
    const response = await PATCH(request({ action: 'approve', stallNumber: 'A12', expectedUpdatedAt }), context);
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe('STALL_CONFLICT');
    expect(JSON.stringify(body)).not.toContain('secret-internal-id');
    expect(mocks.mail).not.toHaveBeenCalled();
  });
});
