import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  retrieve: vi.fn(),
  refundsCreate: vi.fn(),
  reverseSettlement: vi.fn(),
}));
vi.mock('@/lib/stripe', () => ({ stripe: { checkout: { sessions: { retrieve: mocks.retrieve } }, refunds: { create: mocks.refundsCreate } } }));
vi.mock('@/lib/vendor/settlement', () => ({ reverseOrderVendorSettlement: mocks.reverseSettlement }));

import { processRefund } from '@/lib/refunds/process-refund';
import { processQueuedEventRefunds } from '@/lib/refunds/process-queued-event-refunds';

type Payment = { method: string; provider: string; provider_payment_id: string | null };

/** A service-client stub that records updates per table. */
function serviceStub(refund: Record<string, unknown> | null, queued: { id: string }[] = []) {
  const updates: Array<{ table: string; values: Record<string, unknown> }> = [];
  const rpc = vi.fn(async () => ({ data: { status: 'processed' }, error: null }));
  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {};
    const result = table === 'refunds' ? { data: refund, error: null } : { data: null, error: null };
    for (const method of ['select', 'eq', 'order', 'limit']) builder[method] = vi.fn(() => builder);
    builder.maybeSingle = vi.fn(async () => result);
    builder.update = vi.fn((values: Record<string, unknown>) => {
      updates.push({ table, values });
      const chain: Record<string, unknown> = {};
      chain.eq = vi.fn(() => chain);
      chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve);
      return chain;
    });
    builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: queued, error: null }).then(resolve);
    return builder;
  });
  return { service: { from, rpc } as never, updates, rpc };
}

function refundRow(payment: Payment, status = 'pending') {
  return { id: 'refund-1', order_id: 'order-1', payment_id: 'payment-1', amount: 28, status, payments: payment };
}

describe('processRefund', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.retrieve.mockResolvedValue({ payment_intent: 'pi_1' });
    mocks.refundsCreate.mockResolvedValue({ id: 're_1' });
  });

  it('refunds a Stripe card payment in full, then marks refund, payment and order refunded', async () => {
    const { service, updates } = serviceStub(refundRow({ method: 'stripe_card', provider: 'stripe', provider_payment_id: 'cs_1' }));

    const result = await processRefund({ service, walletDb: service, refundId: 'refund-1', actorId: null });

    expect(result.ok).toBe(true);
    expect(mocks.refundsCreate).toHaveBeenCalledWith({ payment_intent: 'pi_1', amount: 2800 }, { idempotencyKey: 'refund:refund-1' });
    expect(updates.map((update) => update.table)).toEqual(['refunds', 'payments', 'orders']);
    // The cancellation reason survives when there is no admin note.
    expect(updates[0].values).not.toHaveProperty('reason');
    expect(mocks.reverseSettlement).toHaveBeenCalledWith(service, 'order-1', 2800);
  });

  it('refunds a wallet payment through process_wallet_refund on the given client', async () => {
    const { service, rpc } = serviceStub(refundRow({ method: 'wallet', provider: 'platform', provider_payment_id: null }));

    const result = await processRefund({ service, walletDb: service, refundId: 'refund-1', actorId: null });

    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith('process_wallet_refund', { p_refund_id: 'refund-1', p_note: null });
    expect(mocks.refundsCreate).not.toHaveBeenCalled();
  });

  it('never marks an automatic refund processed without a provider refund', async () => {
    const { service, updates } = serviceStub(refundRow({ method: 'bank_transfer', provider: 'toyyibpay', provider_payment_id: 'bill-1' }));

    const result = await processRefund({ service, walletDb: service, refundId: 'refund-1', actorId: null, providerRefundOnly: true });

    expect(result).toMatchObject({ ok: false, code: 'MANUAL_REFUND_REQUIRED' });
    expect(updates).toEqual([]);
  });

  it('refuses a refund that is no longer pending', async () => {
    const { service } = serviceStub(refundRow({ method: 'stripe_card', provider: 'stripe', provider_payment_id: 'cs_1' }, 'processed'));
    const result = await processRefund({ service, walletDb: service, refundId: 'refund-1', actorId: null });
    expect(result).toMatchObject({ ok: false, code: 'INVALID_STATE' });
    expect(mocks.refundsCreate).not.toHaveBeenCalled();
  });
});

describe('processQueuedEventRefunds', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hands a refund that cannot be automated to the admin queue instead of retrying it', async () => {
    const { service, updates } = serviceStub(
      refundRow({ method: 'bank_transfer', provider: 'toyyibpay', provider_payment_id: 'bill-1' }),
      [{ id: 'refund-1' }],
    );

    const result = await processQueuedEventRefunds(service);

    expect(result).toMatchObject({ processed: 0, handedToAdmin: 1 });
    expect(updates).toEqual([{ table: 'refunds', values: expect.objectContaining({ auto_process: false, provider_failure_code: 'MANUAL_REFUND_REQUIRED' }) }]);
  });
});
