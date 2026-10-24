import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), rate: vi.fn(), rpc: vi.fn(), schedule: vi.fn() }));
vi.mock('@/lib/checkout/order-access', () => ({ authorizeOrder: mocks.authorize }));
vi.mock('@/lib/checkout/guest-session', () => ({ reserveGuestRateLimit: mocks.rate }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/email/events', () => ({ scheduleReceiptDelivery: mocks.schedule }));
import { POST } from '../route';
const orderId = '22222222-2222-4222-8222-222222222222';
const request = () => new Request('https://portal.example.test/api/orders/receipt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orderId }) });
describe('authorized durable receipt request', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.authorize.mockResolvedValue({ order: { id: orderId, status: 'paid' }, userId: 'owner-test', guestSubjectId: null });
    mocks.rate.mockResolvedValue(true); mocks.rpc.mockResolvedValue({ data: true, error: null });
  });
  it('queues the canonical receipt without claiming SMTP delivery', async () => {
    const response = await POST(request());
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ data: { queued: true } });
    expect(mocks.rpc).toHaveBeenCalledWith('queue_order_receipt', { p_order_id: orderId, p_request_hour: expect.any(Number) });
    expect(mocks.schedule).toHaveBeenCalledOnce();
  });
  it('returns 503 rather than sent when persistence fails', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'private details' } });
    const response = await POST(request());
    expect(response.status).toBe(503); expect(mocks.schedule).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain('private details');
  });
  it('does not query or email an unauthorized order', async () => {
    mocks.authorize.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(404); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('accepts completed orders and blocks unpaid orders', async () => {
    mocks.authorize.mockResolvedValue({ order: { status: 'completed' } });
    expect((await POST(request())).status).toBe(202);
    mocks.authorize.mockResolvedValue({ order: { status: 'pending_payment' } });
    expect((await POST(request())).status).toBe(409);
  });
  it('queues an explicit Guest resend with an hourly request key', async () => {
    mocks.authorize.mockResolvedValue({ order: { status: 'paid' }, guestSubjectId: 'guest-test' });
    expect((await POST(request())).status).toBe(202);
    expect(mocks.rpc).toHaveBeenCalledWith('queue_order_receipt', { p_order_id: orderId, p_request_hour: Math.floor(Date.now() / 3_600_000) });
  });
  it('does not falsely report a rate-limited Guest request as sent', async () => {
    mocks.authorize.mockResolvedValue({ order: { status: 'paid' }, guestSubjectId: 'guest-test' }); mocks.rate.mockResolvedValue(false);
    expect((await POST(request())).status).toBe(429); expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
