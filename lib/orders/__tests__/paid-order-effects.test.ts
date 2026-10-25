import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  steps: [] as string[],
  status: 'paid',
  onOrderPaidOk: true,
  rewardThrows: false,
  rewardCreated: false,
  markError: null as { message: string } | null,
  notificationError: null as { message: string } | null,
  emailReject: false,
  feeFloorOk: true,
  emailKeys: [] as string[],
  notificationKeys: [] as string[],
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
vi.mock('@/lib/vendor/settlement', () => ({ applyOrderPlatformFeeFloor: async () => { mocks.steps.push('fee floor'); return mocks.feeFloorOk; } }));
vi.mock('@/lib/email/events', () => ({ enqueueUserTransactionEmail: async (input: { eventKey: string }) => { mocks.steps.push('reward email'); mocks.emailKeys.push(input.eventKey); if (mocks.emailReject) throw new Error('email unavailable'); } }));

function service() {
  return {
    from: (table: string) => {
      if (table === 'notifications') return { upsert: async (row: { event_key: string }) => { mocks.steps.push('reward notification'); mocks.notificationKeys.push(row.event_key); return { error: mocks.notificationError }; } };
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'in', 'is', 'gte', 'order']) chain[method] = () => chain;
      chain.maybeSingle = async () => ({ data: { status: mocks.status } });
      chain.limit = async () => ({ data: mocks.pendingOrders, error: null });
      chain.update = () => ({ eq: async () => { mocks.steps.push('mark processed'); return { error: mocks.markError }; } });
      return chain;
    },
    rpc: async (name: string) => name === 'claim_paid_order_effects'
      ? { data: mocks.pendingOrders.map(({ id }) => ({ order_id: id, lease_token: `lease-${id}` })), error: null }
      : { data: true, error: null },
  } as never;
}

import { processPaidOrders, runPaidOrderEffects } from '../paid-order-effects';

describe('runPaidOrderEffects', () => {
  beforeEach(() => {
    Object.assign(mocks, { steps: [], status: 'paid', onOrderPaidOk: true, rewardThrows: false, rewardCreated: false, markError: null, notificationError: null, emailReject: false, feeFloorOk: true, emailKeys: [], notificationKeys: [], pendingOrders: [] });
  });

  it('runs commission, rewards, the fee floor and only then marks the order done', async () => {
    expect(await runPaidOrderEffects(service(), 'order-1')).toBe(true);
    expect(mocks.steps).toEqual(['commission', 'rewards', 'fee floor', 'mark processed']);
  });

  it('notifies a recommender when a reward was created', async () => {
    mocks.rewardCreated = true;
    await runPaidOrderEffects(service(), 'order-1');
    expect(mocks.steps).toEqual(expect.arrayContaining(['reward notification', 'reward email']));
    expect(mocks.emailKeys).toEqual(['reward_pending:email:c1']);
    expect(mocks.notificationKeys).toEqual(['reward_pending:in_app:c1']);
  });

  it('keeps the order retryable when the email intent cannot be saved', async () => {
    mocks.rewardCreated = true;
    mocks.emailReject = true;
    expect(await runPaidOrderEffects(service(), 'order-1')).toBe(false);
    expect(mocks.steps).not.toContain('mark processed');
  });

  it('keeps the order retryable when the platform fee floor RPC fails', async () => {
    mocks.feeFloorOk = false;
    expect(await runPaidOrderEffects(service(), 'order-1')).toBe(false);
    expect(mocks.steps).not.toContain('mark processed');
  });

  it('does not mark an order processed when a fulfilled notification write returns an error', async () => {
    mocks.rewardCreated = true;
    mocks.notificationError = { message: 'synthetic write failure' };

    expect(await runPaidOrderEffects(service(), 'order-1')).toBe(false);
    expect(mocks.steps).not.toContain('mark processed');
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
    Object.assign(mocks, { steps: [], status: 'paid', onOrderPaidOk: true, rewardThrows: false, rewardCreated: false, markError: null, notificationError: null, emailReject: false, feeFloorOk: true, emailKeys: [], notificationKeys: [], pendingOrders: [] });
  });

  it('processes each waiting paid order and counts failures separately', async () => {
    mocks.pendingOrders = [{ id: 'a' }, { id: 'b' }];
    expect(await processPaidOrders(service())).toEqual({ processed: 2, failed: 0 });
    mocks.markError = { message: 'boom' };
    expect(await processPaidOrders(service())).toEqual({ processed: 0, failed: 2 });
  });
});
