import { beforeEach, describe, expect, it, vi } from 'vitest';

const LISTING_ID = '11111111-1111-4111-8111-111111111111';
const SLOT_ID = '22222222-2222-4222-8222-222222222222';
const CHECKOUT_ID = '77777777-7777-4777-8777-777777777777';
const ORDER_ID = '88888888-8888-4888-8888-888888888888';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  serviceFrom: vi.fn(),
  stripeCreate: vi.fn(),
  resolveEffectiveCapability: vi.fn(),
}));

vi.mock('@/lib/entitlements/server', () => ({ resolveEffectiveCapability: mocks.resolveEffectiveCapability }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc, from: mocks.from })),
}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mocks.serviceFrom, rpc: mocks.rpc })),
}));
vi.mock('@/lib/stripe', () => ({ stripe: { checkout: { sessions: { create: mocks.stripeCreate } } } }));

import { POST } from '../route';

function queryResult(data: unknown) {
  const terminal = Promise.resolve({ data, error: null });
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'update']) builder[method] = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(() => terminal);
  builder.then = terminal.then.bind(terminal);
  return builder;
}

function request(body: Record<string, unknown>) {
  return new Request('http://localhost/api/customer/event-reservations', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
    body: JSON.stringify({
      listingId: LISTING_ID,
      pickupDate: '2026-10-05',
      slotId: SLOT_ID,
      quantity: 2,
      paymentMethod: 'stripe_card',
      idempotencyKey: 'event-reservation-key-123456',
      ...body,
    }),
  });
}

describe('POST /api/customer/event-reservations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: '99999999-9999-4999-8999-999999999999', email: 'c@example.com' } }, error: null });
    mocks.resolveEffectiveCapability.mockImplementation(async (_userId: string, capability: string) => ({
      capability, allowed: true, blockerCode: null, qualificationPaths: [], entitlementGeneration: 1, source: 'policy',
    }));
    mocks.from.mockImplementation(() => queryResult({ phone_verified_at: '2026-09-01T00:00:00Z' }));
    mocks.serviceFrom.mockImplementation(() => queryResult(null));
    mocks.stripeCreate.mockResolvedValue({ id: 'cs_evt', url: 'https://checkout.stripe.test/cs_evt' });
  });

  it('prepares the reservation in SQL and charges the total SQL returns, never a client price', async () => {
    mocks.rpc.mockImplementation(async (name: string) => name === 'prepare_event_checkout'
      ? { data: { checkout_session_id: CHECKOUT_ID, order_id: ORDER_ID, status: 'pending_payment', total: 28 }, error: null }
      : { data: null, error: null });

    const response = await POST(request({}));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('prepare_event_checkout', expect.objectContaining({
      p_listing_id: LISTING_ID, p_pickup_date: '2026-10-05', p_slot_id: SLOT_ID, p_quantity: 2, p_payment_method: 'stripe_card',
    }));
    expect(mocks.stripeCreate).toHaveBeenCalledWith(expect.objectContaining({
      line_items: [expect.objectContaining({ price_data: expect.objectContaining({ unit_amount: 2800 }) })],
    }));
    expect(body.data).toMatchObject({ order_id: ORDER_ID, stripeUrl: 'https://checkout.stripe.test/cs_evt' });
  });

  it('rejects a price or total sent by the client', async () => {
    const response = await POST(request({ price: 0 }));
    expect(response.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalledWith('prepare_event_checkout', expect.anything());
  });

  it('confirms a free reservation without any payment provider', async () => {
    mocks.rpc.mockResolvedValue({ data: { checkout_session_id: CHECKOUT_ID, order_id: ORDER_ID, status: 'paid', total: 0 }, error: null });

    const response = await POST(request({ paymentMethod: 'free_reservation' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { order_id: ORDER_ID, status: 'paid' } });
    expect(mocks.stripeCreate).not.toHaveBeenCalled();
  });

  it('prepares a wallet split as a card payment, like the cart checkout', async () => {
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'prepare_event_checkout') return { data: { checkout_session_id: CHECKOUT_ID, order_id: ORDER_ID, status: 'pending_payment', total: 28 }, error: null };
      if (name === 'reserve_wallet_split_checkout') return { data: { wallet_amount_sen: 800, external_amount_sen: 2000, status: 'reserved' }, error: null };
      return { data: null, error: null };
    });

    const response = await POST(request({ paymentMethod: 'wallet_split' }));

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('prepare_event_checkout', expect.objectContaining({ p_payment_method: 'stripe_card' }));
    expect(mocks.stripeCreate).toHaveBeenCalledWith(expect.objectContaining({
      line_items: [expect.objectContaining({ price_data: expect.objectContaining({ unit_amount: 2000 }) })],
    }));
  });

  it.each([
    ['event_sold_out', 'EVENT_SOLD_OUT'],
    ['event_slot_full', 'EVENT_SLOT_FULL'],
    ['event_date_invalid', 'EVENT_DATE_INVALID'],
    ['something unexpected', 'CHECKOUT_FAILED'],
  ])('maps %s to %s', async (message, code) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message } });

    const response = await POST(request({}));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: { code } });
    expect(mocks.stripeCreate).not.toHaveBeenCalled();
  });

  it('blocks checkout when the customer is not verified', async () => {
    mocks.resolveEffectiveCapability.mockImplementation(async (_userId: string, capability: string) => ({
      capability, allowed: false, blockerCode: 'phone_verification_required', qualificationPaths: [], entitlementGeneration: 1, source: 'policy',
    }));

    const response = await POST(request({}));

    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalledWith('prepare_event_checkout', expect.anything());
  });
});
