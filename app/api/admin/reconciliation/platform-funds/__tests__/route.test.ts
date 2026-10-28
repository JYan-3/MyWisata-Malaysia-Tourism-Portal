import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc })),
}));
// The route must never fall back to the service role: the database functions check the caller.
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => { throw new Error('service role must not be used'); } }));

import { GET, POST } from '../route';

const post = (body: unknown) => POST(new Request('http://localhost/api/admin/reconciliation/platform-funds', { method: 'POST', body: JSON.stringify(body) }));
const TRANSFER_ID = '11111111-1111-4111-8111-111111111111';

describe('platform funds API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'admin-1' } } });
    mocks.rpc.mockResolvedValue({ data: { availableSen: 0 }, error: null });
  });

  it('requires sign-in before reading or writing', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    expect((await GET()).status).toBe(401);
    expect((await post({ action: 'record', amountSen: 100, transferredOn: '2026-10-25', reference: 'MBB-123' })).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('reads the summary through the caller-checked database function', async () => {
    mocks.rpc.mockResolvedValue({ data: { owed: { totalSen: 5 }, availableSen: 0, transfers: [] }, error: null });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('get_platform_funds');
    expect((await response.json()).data.owed.totalSen).toBe(5);
  });

  it('records a transfer with whole-sen amounts and trims the note', async () => {
    const response = await post({ action: 'record', amountSen: 125050, transferredOn: '2026-10-25', reference: ' MBB-778899 ', note: '  ' });
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('record_platform_transfer', { p_amount_sen: 125050, p_transferred_on: '2026-10-25', p_reference: 'MBB-778899', p_note: null });
  });

  it.each([
    { action: 'record', amountSen: 0, transferredOn: '2026-10-25', reference: 'MBB-1' },
    { action: 'record', amountSen: 10.5, transferredOn: '2026-10-25', reference: 'MBB-1' },
    { action: 'record', amountSen: 100, transferredOn: '25/10/2026', reference: 'MBB-1' },
    { action: 'record', amountSen: 100, transferredOn: '2026-10-25', reference: 'x' },
    { action: 'record', amountSen: 100, transferredOn: '2026-10-25', reference: 'MBB-1', extra: true },
    { action: 'void', id: 'not-a-uuid', reason: 'Duplicate entry' },
    { action: 'void', id: TRANSFER_ID, reason: 'no' },
    { action: 'delete', id: TRANSFER_ID },
  ])('rejects invalid input before any database call: %j', async (body) => {
    expect((await post(body)).status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('voids a transfer with a reason', async () => {
    await post({ action: 'void', id: TRANSFER_ID, reason: '  Recorded twice  ' });
    expect(mocks.rpc).toHaveBeenCalledWith('void_platform_transfer', { p_id: TRANSFER_ID, p_reason: 'Recorded twice' });
  });

  it.each([
    ['platform_funds_super_admin_required', 403, 'FORBIDDEN'],
    ['platform_transfer_exceeds_available', 409, 'EXCEEDS_AVAILABLE'],
    ['platform_transfer_not_found', 404, 'NOT_FOUND'],
    ['platform_transfer_invalid', 422, 'VALIDATION_FAILED'],
    ['secret database detail', 503, 'PLATFORM_FUNDS_UNAVAILABLE'],
  ])('maps %s without exposing the database message', async (message, status, code) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message } });
    const response = await post({ action: 'record', amountSen: 100, transferredOn: '2026-10-25', reference: 'MBB-123' });
    expect(response.status).toBe(status);
    const body = await response.json();
    expect(body.error.code).toBe(code);
    expect(JSON.stringify(body)).not.toContain(message);
  });
});
