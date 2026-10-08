import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), process: vi.fn() }));
vi.mock('@/lib/staff-permissions/server', () => ({ requireStaffPermission: mocks.auth }));
vi.mock('@/lib/email/outbox', () => ({ processEmailOutbox: mocks.process }));
import { PATCH } from '@/app/api/admin/event-registrations/[id]/stall/route';

const id = '11111111-1111-4111-8111-111111111111';
const data = { stallNumber: 'B08', reason: 'Entrance layout changed', expectedUpdatedAt: '2026-10-07T00:00:00Z' };
const req = (body: unknown) => new Request('http://localhost/stall', { method: 'PATCH', body: JSON.stringify(body) });
const context = { params: Promise.resolve({ id }) };
describe('Admin stall changes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({ db: { rpc: mocks.rpc }, user: { id: 'admin' }, response: null });
    mocks.rpc.mockResolvedValue({ data: { ...data, notificationQueued: true }, error: null });
    mocks.process.mockResolvedValue({ sent: 1, failed: 0 });
  });
  it('checks permission before reading any submitted content', async () => {
    mocks.auth.mockResolvedValue({ response: Response.json({}, { status: 403 }) });
    const json = vi.fn();
    expect((await PATCH({ json } as never, context)).status).toBe(403);
    expect(json).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('uses the guarded mutation and only processes notices after success', async () => {
    expect((await PATCH(req(data), context)).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('change_campaign_vendor_stall', {
      p_registration_id: id, p_expected_updated_at: data.expectedUpdatedAt, p_stall_number: 'B08', p_reason: data.reason,
    });
    expect(mocks.process).toHaveBeenCalled();
  });
  it('does not report delivery failure as a failed mutation or send again on no-op', async () => {
    mocks.process.mockRejectedValueOnce(new Error('SMTP unavailable'));
    expect((await PATCH(req(data), context)).status).toBe(200);
    mocks.process.mockClear();
    mocks.rpc.mockResolvedValueOnce({ data: { notificationQueued: false }, error: null });
    expect((await PATCH(req(data), context)).status).toBe(200);
    expect(mocks.process).not.toHaveBeenCalled();
  });
  it('returns safe business conflicts without leaking SQL details or sending mail', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'event_change_stale secret database value' } });
    const response = await PATCH(req(data), context);
    expect(response.status).toBe(409);
    expect((await response.text())).not.toContain('secret database');
    expect(mocks.process).not.toHaveBeenCalled();
  });
  it('rejects invalid identifiers and unexpected recipient fields', async () => {
    expect((await PATCH(req(data), { params: Promise.resolve({ id: 'bad' }) })).status).toBe(422);
    expect((await PATCH(req({ ...data, toEmail: 'someone@example.com' }), context)).status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
