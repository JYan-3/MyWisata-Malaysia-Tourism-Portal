import { beforeEach, describe, expect, it, vi } from 'vitest';

const { permission, claims } = vi.hoisted(() => ({ permission: vi.fn(), claims: vi.fn() }));
vi.mock('@/lib/staff-permissions/server', () => ({ requireStaffPermission: permission }));
const { requireKycReviewer } = await import('../reviewer-auth');
const user = { id: '11111111-1111-4111-8111-111111111111' };

describe('KYC reviewer assurance boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    permission.mockResolvedValue({ user, db: { auth: { getClaims: claims } }, response: null });
    claims.mockResolvedValue({ data: { claims: { sub: user.id, aal: 'aal2' } }, error: null });
  });
  it('preserves permission denial before inspecting assurance', async () => {
    const response = new Response(null, { status: 403 });
    permission.mockResolvedValue({ user, db: {}, response });
    expect((await requireKycReviewer()).response).toBe(response);
    expect(claims).not.toHaveBeenCalled();
  });
  it('denies password-only sessions even for permitted staff', async () => {
    claims.mockResolvedValue({ data: { claims: { sub: user.id, aal: 'aal1' } }, error: null });
    const result = await requireKycReviewer();
    expect(result.response?.status).toBe(403);
    expect(await result.response?.json()).toMatchObject({ error: { code: 'KYC_MFA_REQUIRED' } });
  });
  it('accepts verified AAL2 for the same authenticated user', async () => {
    expect((await requireKycReviewer()).response).toBeNull();
    expect(permission).toHaveBeenCalledWith('admin.kyc.review');
  });
  it.each([
    { data: null, error: new Error('private token') },
    { data: { claims: { sub: 'another-user', aal: 'aal2' } }, error: null },
  ])('fails closed for invalid or mismatched claims', async (value) => {
    claims.mockResolvedValue(value);
    const result = await requireKycReviewer();
    expect(result.response?.status).toBe(503);
    expect(await result.response?.text()).not.toContain('private token');
  });
  it('fails closed when Auth throws', async () => {
    claims.mockRejectedValue(new Error('secret details'));
    const result = await requireKycReviewer();
    expect(result.response?.status).toBe(503);
  });
});
