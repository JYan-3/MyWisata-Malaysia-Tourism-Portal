import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requireStaffAssurance } from '../staff-assurance';
import { safeStaffVerificationNext, staffVerificationDestination, isStaffProtectedPath } from '../staff-route-boundaries';
const claims = { sub: '11111111-1111-4111-8111-111111111111', session_id: '22222222-2222-4222-8222-222222222222', amr: [{ method: 'password', timestamp: 100 }] };
describe('staff assurance guard', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('leaves legacy local role and KYC checks reachable without consulting missing Passkey schema', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('MYWISATA_DEMO_TOOLS', 'true');
    vi.stubEnv('MYWISATA_LOCAL_LEGACY_STAFF_AUTH', 'true');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000');
    const db = { rpc: vi.fn().mockRejectedValue(new Error('missing schema')) };
    expect(await requireStaffAssurance(db as unknown as SupabaseClient)).toBeNull();
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it.each([['password only', false, claims], ['OAuth', true, { ...claims, amr: [{ method: 'oauth', timestamp: 100 }] }], ['malformed signed session', true, { ...claims, session_id: '' }]])('denies %s even if UI claims verification', async (_name, verified, signedClaims) => {
    const db = { auth: { getClaims: vi.fn().mockResolvedValue({ data: { claims: signedClaims }, error: null }) }, rpc: vi.fn().mockResolvedValue({ data: { required: true, verified, passwordAuthenticated: true }, error: null }) };
    expect((await requireStaffAssurance(db as unknown as SupabaseClient))?.status).toBe(403);
  });
  it('requires signed claims and the database assurance record together', async () => {
    const db = { auth: { getClaims: vi.fn().mockResolvedValue({ data: { claims }, error: null }) }, rpc: vi.fn().mockResolvedValue({ data: { required: true, verified: true, passwordAuthenticated: true }, error: null }) };
    expect(await requireStaffAssurance(db as unknown as SupabaseClient)).toBeNull();
    db.rpc.mockResolvedValueOnce({ data: null, error: { message: 'internal database' } });
    expect((await requireStaffAssurance(db as unknown as SupabaseClient))?.status).toBe(503);
  });
});
describe('staff verification routing', () => {
  it('preserves valid staff destinations and rejects external or unrelated destinations', () => {
    expect(safeStaffVerificationNext('/admin/withdrawals')).toBe('/admin/withdrawals');
    expect(safeStaffVerificationNext('/staff')).toBe('/staff');
    for (const path of ['//evil.example','https://evil.example','/customer','/admin/../customer','/admin\\evil','/api/admin']) expect(safeStaffVerificationNext(path)).toBe('/admin/dashboard');
    expect(staffVerificationDestination('/admin/withdrawals')).toBe('/auth/staff-verification?next=%2Fadmin%2Fwithdrawals');
  });
  it('covers admin pages and APIs without blocking customer/vendor ownership paths', () => {
    for (const path of ['/admin','/admin/refunds','/staff','/api/admin/users','/api/admin-ai/ask']) expect(isStaffProtectedPath(path)).toBe(true);
    for (const path of ['/customer','/api/wallet','/api/vendor/settlements','/api/auth/staff-passkey/challenge','/administrator']) expect(isStaffProtectedPath(path)).toBe(false);
  });
});
