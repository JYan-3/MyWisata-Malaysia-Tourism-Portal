import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), abortSignal: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ rpc: mocks.rpc.mockReturnValue({ abortSignal: mocks.abortSignal }) })),
}));

const { getFinancialOperationsHealth } = await import('../queue-health');

const queue = {
  availability: 'available', pending: 2, oldestPendingSeconds: 60, enteredLastHour: 3,
  reenteredLastHour: null, retriesLastHour: null, completedLastHour: 1,
  reviewRequired: 0, sampleCount: 4, unavailableReason: null,
};
const health = {
  computedAt: '2026-10-25T00:00:00.000Z',
  windowStart: '2026-10-24T23:00:00.000Z', windowEnd: '2026-10-25T00:00:00.000Z',
  availability: 'available', unavailableReasons: [],
  queues: { paidEffects: queue, affiliateClearing: queue, guestReview: queue, withdrawalReview: queue, payoutUnknown: queue, refundPending: queue },
  liabilitiesSen: { pendingEarnings: 100, availableEarnings: 500, reservedEarnings: 20 },
  economicsSen: { refundClawbackShortfall: 0, postMaturityExposure: 40, stackedRewardCost: 25, payoutFees: 0, netMargin: null },
  fraudReviewSample: { resolved: 1, released: 1, rejected: 0 }, cashAvailableSen: null,
};

describe('getFinancialOperationsHealth', () => {
  afterEach(() => vi.clearAllMocks());

  it('calls the low-frequency service-only snapshot RPC with a five-second deadline', async () => {
    mocks.abortSignal.mockResolvedValue({ data: health, error: null });
    const result = await getFinancialOperationsHealth();
    expect(mocks.rpc).toHaveBeenCalledWith('financial_operations_health');
    expect(mocks.abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(result).toEqual(health);
  });

  it('fails closed instead of representing missing financial evidence as healthy zeros', async () => {
    mocks.abortSignal.mockResolvedValue({ data: null, error: { message: 'timeout' } });
    await expect(getFinancialOperationsHealth()).rejects.toThrow('financial_operations_health_unavailable');
  });
});
