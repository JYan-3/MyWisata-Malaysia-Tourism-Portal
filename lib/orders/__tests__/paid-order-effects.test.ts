import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  steps: [] as string[],
  status: 'paid',
  onOrderPaidOk: true,
  rewardThrows: false,
  rewardCreated: false,
  markError: null as { message: string } | null,
  pendingOrders: [] as Array<{ id: string }>,
}));

vi.mock('@/lib/affiliate/attribution', () => ({ onOrderPaid: async () => { mocks.steps.push('commission'); return mocks.onOrderPaidOk; } }));
vi.mock('@/lib/recommendations/reward-attribution', () => ({
  attributeRecommendationReward: async () => {
    mocks.steps.push('rewards');
    if (mocks.rewardThrows) throw new Error('db down');
    return mocks.rewardCreated ? { kind: 'created', rewards: [{ commissionId: 'c1', recommenderId: 'r1', amountSen: 5000 }] } : { kind: 'skipped' };
  },
}));
vi.mock('@/lib/vendor/settlement', () => ({ applyOrderPlatformFeeFloor: async () => { mocks.steps.push('fee floor'); } }));
vi.mock('@/lib/email/events', () => ({ enqueueUserTransactionEmail: async () => { mocks.steps.push('reward email'); } }));

function service() {
  return {
    from: (table: string) => {
      if (table === 'notifications') return { insert: async () => { mocks.steps.push('reward notification'); return { error: null }; } };
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'in', 'is', 'gte', 'order']) chain[method] = () => chain;
      chain.maybeSingle = async () => ({ data: { status: mocks.status } });
      chain.limit = async () => ({ data: mocks.pendingOrders, error: null });
      chain.update = () => ({ eq: async () => { mocks.steps.push('mark processed'); return { error: mocks.markError }; } });
      return chain;
    },
  } as never;
}

import { processPaidOrders, runPaidOrderEffects } from '../paid-order-effects';

describe('runPaidOrderEffects', () => {
  beforeEach(() => {
    Object.assign(mocks, { steps: [], status: 'paid', onOrderPaidOk: true, rewardThrows: false, rewardCreated: false, markError: null, pendingOrders: [] });
  });

  it('runs commission, rewards, the fee floor and only then marks the order done', async () => {
    expect(await runPaidOrderEffects(service(), 'order-1')).toBe(true);
    expect(mocks.steps).toEqual(['commission', 'rewards', 'fee floor', 'mark processed']);
  });

  it('notifies a recommender when a reward was created', async () => {
    mocks.rewardCreated = true;
    await runPaidOrderEffects(service(), 'order-1');
    expect(mocks.steps).toEqual(expect.arrayContaining(['reward notification', 'reward email']));
  });

  it('leaves an unpaid order alone so it is processed once paid', async () => {
    mocks.status = 'pending_payment';
    expect(await runPaidOrderEffects(service(), 'order-1')).toBe(false);
    expect(mocks.steps).toEqual([]);
  });

  it('does not mark the order done when a step fails, so the job retries it', async () => {
    mocks.rewardThrows = true;
    expect(await runPaidOrderEffects(service(), 'order-1')).toBe(false);
    expect(mocks.steps).not.toContain('mark processed');

    mocks.steps = [];
    mocks.rewardThrows = false;
    mocks.onOrderPaidOk = false;
    expect(await runPaidOrderEffects(service(), 'order-1')).toBe(false);
    expect(mocks.steps).toEqual(['commission']);
  });
});

describe('processPaidOrders', () => {
  beforeEach(() => {
    Object.assign(mocks, { steps: [], status: 'paid', onOrderPaidOk: true, rewardThrows: false, rewardCreated: false, markError: null, pendingOrders: [] });
  });

  it('processes each waiting paid order and counts failures separately', async () => {
    mocks.pendingOrders = [{ id: 'a' }, { id: 'b' }];
    expect(await processPaidOrders(service())).toEqual({ processed: 2, failed: 0 });
    mocks.markError = { message: 'boom' };
    expect(await processPaidOrders(service())).toEqual({ processed: 0, failed: 2 });
  });
});
