import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ guard: vi.fn(), rpc: vi.fn(), from: vi.fn(), tables: {} as Record<string, unknown> }));
vi.mock('@/lib/entitlements/admin-guard', () => ({ requireAccessControlSuperAdmin: mocks.guard }));
vi.mock('@/lib/checkout/guest-session', () => ({ isSameOriginMutation: vi.fn(() => true) }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ from: mocks.from }) }));

import { GET, POST } from '../route';

const ORDER = '11111111-1111-4111-8111-111111111111';
const REQUEST = '22222222-2222-4222-8222-222222222222';
const TICKET = '33333333-3333-4333-8333-333333333333';

function query(result: unknown) {
  const builder: Record<string, unknown> = {};
  for (const key of ['select', 'eq', 'is', 'in', 'or', 'order', 'limit']) builder[key] = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(async () => result);
  builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

function request(body: unknown) {
  return new Request(`https://example.test/api/admin/orders/${ORDER}/guest-contact`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://example.test' }, body: JSON.stringify(body),
  });
}

describe('POST /api/admin/orders/[orderId]/guest-contact', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.guard.mockResolvedValue({ user: { id: 'staff-id' }, response: null, db: { rpc: mocks.rpc } });
    mocks.rpc.mockResolvedValue({ data: { orderId: ORDER, orderReference: 'ORD-42', delivery: 'queued', replayed: false }, error: null });
    mocks.tables = {
      orders: query({ data: { id: ORDER, display_id: 'ORD-42', user_id: null, guest_subject_id: 'guest-id', status: 'paid', contact_email: 'old@example.test', total_amount: 15, currency: 'MYR' }, error: null }),
      order_items: query({ data: [], error: null }),
      payments: query({ data: [], error: null }),
      email_outbox: query({ data: [], error: null }),
    };
    mocks.from.mockImplementation((table: string) => mocks.tables[table]);
  });

  it('returns an exact, read-only eligible preview to Super Admin', async () => {
    const response = await GET(new Request('https://example.test'), { params: Promise.resolve({ orderId: ORDER }) });
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ eligibility: 'eligible', order: { id: ORDER, displayId: 'ORD-42', contactEmail: 'old@example.test' } });
  });

  it('requires Super Admin assurance before invoking the correction RPC', async () => {
    mocks.guard.mockResolvedValue({ response: new Response('forbidden', { status: 403 }) });
    const response = await POST(request({}), { params: Promise.resolve({ orderId: ORDER }) });
    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects malformed evidence inputs before mutation', async () => {
    const response = await POST(request({ requestId: REQUEST, newEmail: 'not-an-email', supportTicketId: TICKET, evidenceKind: 'existing_order_access' }), { params: Promise.resolve({ orderId: ORDER }) });
    expect(response.status).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('uses the authenticated database RPC with an idempotency key and exact order', async () => {
    const response = await POST(request({ requestId: REQUEST, expectedContactEmail: 'typo@example.test', newEmail: 'right@example.test', supportTicketId: TICKET, evidenceKind: 'existing_order_access' }), { params: Promise.resolve({ orderId: ORDER }) });
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('correct_guest_order_contact', {
      p_order_id: ORDER, p_request_id: REQUEST, p_expected_contact_email: 'typo@example.test', p_new_email: 'right@example.test',
      p_support_ticket_id: TICKET, p_evidence_kind: 'existing_order_access', p_payment_id: null,
    });
  });

  it('translates fulfilment and delivery blockers without exposing database details', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'FULFILMENT_CREDENTIAL_REISSUE_REQUIRED' } });
    const response = await POST(request({ requestId: REQUEST, expectedContactEmail: 'typo@example.test', newEmail: 'right@example.test', supportTicketId: TICKET, evidenceKind: 'existing_order_access' }), { params: Promise.resolve({ orderId: ORDER }) });
    expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).not.toContain('FULFILMENT');
  });
});
