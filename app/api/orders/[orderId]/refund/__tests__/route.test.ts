import { beforeEach, describe, expect, it, vi } from 'vitest';

const USER_ID = '7df122f8-afae-4249-8504-bdd465a78f31';
const ORDER_ID = '1d4057cf-c821-4b05-a454-61dbdc42d32c';
const REFUND_ID = '33333333-3333-4333-8333-333333333333';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  accountFrom: vi.fn(),
  serviceFrom: vi.fn(),
  serviceRpc: vi.fn(),
  emitVendorNotification: vi.fn(),
}));

function queryResult(data: unknown, error: unknown = null) {
  const terminal = Promise.resolve({ data, error });
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq']) builder[method] = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(() => terminal);
  builder.then = terminal.then.bind(terminal);
  return builder;
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser }, from: mocks.accountFrom })),
}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(() => ({ from: mocks.serviceFrom, rpc: mocks.serviceRpc })),
}));
vi.mock('@/lib/vendor-notifications/emit', () => ({
  emitVendorNotification: mocks.emitVendorNotification,
}));

import { POST } from '../route';

function request(body: unknown) {
  return new Request(`http://localhost/api/orders/${ORDER_ID}/refund`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/orders/:orderId/refund', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
    mocks.accountFrom.mockImplementation((table: string) => queryResult(
      table === 'orders' ? { id: ORDER_ID, total_amount: 28, status: 'paid', user_id: USER_ID } : null,
    ));
    mocks.serviceFrom.mockImplementation(() => queryResult([{ vendor_id: 'vendor-1', outlet_id: 'outlet-1' }]));
    mocks.serviceRpc.mockResolvedValue({ data: { id: REFUND_ID, status: 'pending' }, error: null });
    mocks.emitVendorNotification.mockResolvedValue(undefined);
  });

  it('creates a refund through the atomic request RPC and notifies the assigned vendor', async () => {
    const response = await POST(request({ reason: 'Change of plans' }), {
      params: Promise.resolve({ orderId: ORDER_ID }),
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({ data: { id: REFUND_ID, status: 'pending' }, error: null });
    expect(mocks.serviceRpc).toHaveBeenCalledWith('request_order_refund', {
      p_order_id: ORDER_ID,
      p_user_id: USER_ID,
      p_reason: 'Change of plans',
    });
    expect(mocks.emitVendorNotification).toHaveBeenCalledWith(expect.objectContaining({
      eventKey: `order:refund-requested:${ORDER_ID}:${REFUND_ID}`,
      vendorId: 'vendor-1',
      outletId: 'outlet-1',
      audience: 'owner_and_assigned_outlet',
      type: 'vendor_order_refund_requested',
      reference: ORDER_ID,
    }));
  });

  it('rejects an invalid reason before loading or changing the order', async () => {
    const response = await POST(request({ reason: 'no' }), {
      params: Promise.resolve({ orderId: ORDER_ID }),
    });

    expect(response.status).toBe(422);
    expect(mocks.serviceFrom).not.toHaveBeenCalled();
    expect(mocks.serviceRpc).not.toHaveBeenCalled();
  });

  it('does not reveal another customer order or create a refund', async () => {
    mocks.accountFrom.mockImplementation(() => queryResult(null));
    const response = await POST(request({ reason: 'Change of plans' }), {
      params: Promise.resolve({ orderId: ORDER_ID }),
    });

    expect(response.status).toBe(404);
    expect(mocks.serviceRpc).not.toHaveBeenCalled();
    expect(mocks.emitVendorNotification).not.toHaveBeenCalled();
  });

  it('rejects orders that are not paid or completed', async () => {
    mocks.accountFrom.mockImplementation(() => queryResult({ id: ORDER_ID, total_amount: 28, status: 'cancelled', user_id: USER_ID }));
    const response = await POST(request({ reason: 'Change of plans' }), {
      params: Promise.resolve({ orderId: ORDER_ID }),
    });

    expect(response.status).toBe(409);
    expect(mocks.serviceRpc).not.toHaveBeenCalled();
  });

  it('maps an active or completed request to a conflict response', async () => {
    mocks.serviceRpc.mockResolvedValue({ data: null, error: { message: 'refund_already_active' } });
    const response = await POST(request({ reason: 'Change of plans' }), {
      params: Promise.resolve({ orderId: ORDER_ID }),
    });

    expect(response.status).toBe(409);
    expect(mocks.emitVendorNotification).not.toHaveBeenCalled();
  });
});
