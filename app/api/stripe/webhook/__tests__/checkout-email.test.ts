import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORDER_ID = '1d4057cf-c821-4b05-a454-61dbdc42d32c';
const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  rpc: vi.fn(),
  enqueueUserTransactionEmail: vi.fn(),
  emitOrderVendorEvent: vi.fn(),
  log: vi.fn(),
}));

vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers({ 'stripe-signature': 'sig_test' })) }));
vi.mock('@/lib/stripe', () => ({ stripe: { webhooks: { constructEvent: mocks.constructEvent } } }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: vi.fn(() => ({ rpc: mocks.rpc })) }));
vi.mock('@/lib/email/events', () => ({ enqueueUserTransactionEmail: mocks.enqueueUserTransactionEmail }));
vi.mock('@/lib/email/payment', () => ({ getPaymentEmailType: vi.fn(() => ({ eventType: 'checkout_succeeded', keyPrefix: 'order_paid' })) }));
vi.mock('@/lib/vendor-notifications/order-events', () => ({ emitOrderVendorEvent: mocks.emitOrderVendorEvent }));
vi.mock('@/lib/log', () => ({ log: mocks.log }));
vi.mock('@/lib/request-id', () => ({ getRequestId: vi.fn(() => 'request-test') }));

import { POST } from '../route';

describe('Stripe order checkout email recipient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test');
    mocks.constructEvent.mockReturnValue({
      id: 'evt_order_paid',
      type: 'checkout.session.completed',
      created: 1_791_408_000,
      data: { object: {
        id: 'cs_test_order',
        payment_status: 'paid',
        amount_total: 7600,
        currency: 'myr',
        livemode: true,
        metadata: { user_id: '7df122f8-afae-4249-8504-bdd465a78f31', payment_kind: 'order', checkout_session_id: 'cs_checkout' },
      } },
    });
    mocks.rpc.mockImplementation(async (name: string) => name === 'settle_provider_checkout'
      ? { data: { idempotent: false, order_id: ORDER_ID, status: 'paid' }, error: null }
      : { data: null, error: null });
    mocks.enqueueUserTransactionEmail.mockResolvedValue(undefined);
    mocks.emitOrderVendorEvent.mockResolvedValue(undefined);
  });

  afterEach(() => vi.unstubAllEnvs());

  it('passes the paid order id so the email uses its contact address', async () => {
    const response = await POST(new Request('http://localhost/api/stripe/webhook', {
      method: 'POST',
      body: '{"id":"evt_order_paid"}',
    }));

    expect(response.status).toBe(200);
    expect(mocks.enqueueUserTransactionEmail).toHaveBeenCalledWith(expect.objectContaining({
      userId: '7df122f8-afae-4249-8504-bdd465a78f31',
      orderId: ORDER_ID,
    }));
  });
});
