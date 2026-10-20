import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ gate: vi.fn(), rpc: vi.fn(), config: vi.fn(), budget: vi.fn() }));
vi.mock('@/lib/kyc/reviewer-auth', () => ({ requireKycReviewer: mocks.gate }));
vi.mock('@/lib/kyc/ocr', () => ({ privateKycOcrConfiguration: mocks.config }));
vi.mock('@/lib/kyc/prescreening', () => ({ kycPrescreeningBudget: mocks.budget }));
import { GET } from '../route';
beforeEach(() => {
  mocks.gate.mockResolvedValue({ db:{ rpc:mocks.rpc },response:null });
  mocks.rpc.mockReset().mockResolvedValue({data:{submittedToday:10000,effectiveReviewMinutes:null},error:null});
  mocks.config.mockReturnValue(null); mocks.budget.mockReturnValue(null);
});
describe('KYC aggregate operations API', () => {
  it('requires the common reviewer MFA gate before querying metrics', async () => {
    mocks.gate.mockResolvedValue({response:new Response(null,{status:403})});
    expect((await GET()).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('returns real aggregates and does not imply that an absent runtime is enabled', async () => {
    const response = await GET();
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toMatchObject({data:{submittedToday:10000,effectiveReviewMinutes:null,privateOcrConfigured:false}});
  });
  it('reports failure instead of a fabricated zero backlog', async () => {
    mocks.rpc.mockResolvedValue({data:null,error:{message:'private diagnostic'}});
    const response=await GET(); expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private diagnostic');
  });
});
