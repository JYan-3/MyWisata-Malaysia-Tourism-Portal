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
      table === 'orders' ? { id: ORDER_ID, display_id: 'MW-026001', total_amount: 28, status: 'paid', user_id: USER_ID } : null,
    ));
    mocks.serviceFrom.mockImplementation(() => queryResult([{ vendor_id: 'vendor-1', outlet_id: 'outlet-1', vendors: { name: 'Vendor One' } }]));
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
      eventKey: `order:refund-requested:${ORDER_ID}:${REFUND_ID}:vendor-1`,
      vendorId: 'vendor-1',
      outletId: 'outlet-1',
      audience: 'owner_and_assigned_outlet',
      type: 'vendor_order_refund_requested',
      reference: 'MW-026001',
      link: '/vendor/orders',
      metadata: { vendorName: 'Vendor One', orderReference: 'MW-026001' },
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
  it('keeps private customer text and internal IDs out of displayed Vendor details', async () => {
    await POST(request({reason:'PRIVATE customer bank and identity details'}),{params:Promise.resolve({orderId:ORDER_ID})});
    const notice=mocks.emitVendorNotification.mock.calls[0][0];
    const displayed=JSON.stringify({title:notice.title,body:notice.body,link:notice.link,reference:notice.reference,metadata:notice.metadata});
    expect(displayed).toContain('MW-026001');
    expect(displayed).not.toContain(ORDER_ID);
    expect(displayed).not.toContain(REFUND_ID);
    expect(displayed).not.toContain('PRIVATE');
    expect(notice.metadata).not.toHaveProperty('reason');
  });

  it('notifies a null-outlet owner and deduplicates each Vendor/outlet scope', async () => {
    mocks.serviceFrom.mockImplementation(() => queryResult([
      {vendor_id:'vendor-1',outlet_id:null,vendors:{name:'Vendor One'}},
      {vendor_id:'vendor-1',outlet_id:null,vendors:{name:'Vendor One'}},
      {vendor_id:'vendor-2',outlet_id:'outlet-2',vendors:[{name:'Vendor Two'}]},
    ]));
    await POST(request({reason:'Customer request needs review'}),{params:Promise.resolve({orderId:ORDER_ID})});
    expect(mocks.emitVendorNotification).toHaveBeenCalledTimes(2);
    expect(mocks.emitVendorNotification.mock.calls[0][0]).toMatchObject({vendorId:'vendor-1',audience:'owner',metadata:{vendorName:'Vendor One'}});
    expect(mocks.emitVendorNotification.mock.calls[1][0]).toMatchObject({vendorId:'vendor-2',audience:'owner_and_assigned_outlet',metadata:{vendorName:'Vendor Two'}});
    expect(mocks.emitVendorNotification.mock.calls[0][0].eventKey).not.toBe(mocks.emitVendorNotification.mock.calls[1][0].eventKey);
  });

  it('uses a safe fallback when a display reference is absent or contains an internal UUID', async () => {
    mocks.accountFrom.mockImplementation(() => queryResult({id:ORDER_ID,display_id:ORDER_ID,status:'paid',user_id:USER_ID}));
    await POST(request({reason:'Please review this request'}),{params:Promise.resolve({orderId:ORDER_ID})});
    const notice=mocks.emitVendorNotification.mock.calls[0][0];
    expect(notice.reference).toBe('Order');
    expect(notice.body).not.toContain(ORDER_ID);
  });

});
