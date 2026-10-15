import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), from: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser }, from: mocks.from, rpc: mocks.rpc }) }));
import { requireStaffMfaSetup, staffMfaRequiredForSession } from '../staff-mfa';
const userId = '11111111-1111-4111-8111-111111111111';
function query(data: unknown, error: unknown = null) {
  const builder = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), maybeSingle: vi.fn(async () => ({ data, error })), then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error }).then(resolve) };
  builder.select.mockReturnValue(builder); builder.eq.mockReturnValue(builder); builder.is.mockReturnValue(builder);
  return builder;
}
describe('staff native MFA bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
    mocks.from.mockImplementation((table: string) => query(table === 'users' ? { status: 'active' } : [{ vendor_id: null, outlet_id: null, roles: { name: 'super_admin' } }]));
  });
  it('allows only own-factor setup before AAL2 without consulting the gated permission helper', async () => {
    expect((await requireStaffMfaSetup()).response).toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
    for (const call of mocks.from.mock.results) expect(call.value.eq).toHaveBeenCalledWith(expect.stringMatching(/^(id|user_id)$/), userId);
  });
  it('rejects anonymous users before role lookups', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await requireStaffMfaSetup()).response?.status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it.each([
    { status: 'suspended', role: 'super_admin', vendor: null },
    { status: 'active', role: 'customer', vendor: null },
    { status: 'active', role: 'admin', vendor: 'vendor-id' },
  ])('rejects ineligible factor setup: %j', async ({ status, role, vendor }) => {
    mocks.from.mockImplementation((table: string) => query(table === 'users' ? { status } : [{ vendor_id: vendor, outlet_id: null, roles: { name: role } }]));
    expect((await requireStaffMfaSetup()).response?.status).toBe(403);
  });
  it('fails closed on profile or role lookup errors', async () => {
    mocks.from.mockImplementation(() => query(null, { message: 'private database detail' }));
    const result = await requireStaffMfaSetup();
    expect(result.response?.status).toBe(503);
    expect(await result.response?.text()).not.toContain('private database detail');
  });
  it('requires signed AAL2 of the same user to clear the native MFA requirement', async () => {
    const getClaims = vi.fn().mockResolvedValue({ data: { claims: { sub: userId, aal: 'aal1' } }, error: null });
    const db = { auth: { getClaims } } as unknown as SupabaseClient;
    expect(await staffMfaRequiredForSession(db, userId)).toBe(true);
    getClaims.mockResolvedValueOnce({ data: { claims: { sub: userId, aal: 'aal2' } }, error: null });
    expect(await staffMfaRequiredForSession(db, userId)).toBe(false);
    getClaims.mockResolvedValueOnce({ data: { claims: { sub: 'another', aal: 'aal2' } }, error: null });
    await expect(staffMfaRequiredForSession(db, userId)).rejects.toThrow();
  });
});
