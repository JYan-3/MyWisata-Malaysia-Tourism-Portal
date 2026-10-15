import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), update: vi.fn(), send: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({
  rpc: mocks.rpc, from: () => ({ update: mocks.update }),
}) }));
vi.mock('@/lib/email/sender', () => ({
  sendVendorEmail: mocks.send, sendAccountEmail: vi.fn(), sendRecommendationEmail: vi.fn(), sendTransactionEmail: vi.fn(),
}));
vi.mock('@/lib/platform/operations-settings', () => ({ isPlatformOperationEnabled: async () => false, PLATFORM_OPERATION_KEYS: { pauseCustomDelivery: 'email.pause_custom_delivery' } }));
import { EmailDeliveryError } from '@/lib/email/delivery';
import { processEmailOutbox } from '@/lib/email/outbox';
import { renderVendorEmail } from '@/lib/email/templates';
const details = {
  eventTitle: 'Market', locationName: 'Main Hall', startsOn: '2026-11-01', endsOn: '2026-11-08',
  changes: [{ field: 'stallNumber', before: 'A12', after: 'B08' }], reason: 'New layout', actionPath: '/vendor/events',
};
describe('event notices through the existing durable sender', () => {
  beforeEach(async () => {
    vi.resetAllMocks(); vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mylawatan.example');
    mocks.rpc.mockResolvedValue({ data: { rows: [{ id: 'queue-fixture', lease_token: 'test-lease', to_email: 'owner@example.test',
      event_type: 'vendor_event_update', payload: { vendorName: 'Kitchen', reason: details.reason,
        occurredAt: '2026-10-07T03:00:00Z', eventChange: details } }], reviewRequired: 0 }, error: null });
    const claim = await mocks.rpc();
    mocks.rpc.mockImplementation(async name => name === 'claim_email_outbox_delivery' ? claim : { data: true, error: null });
    mocks.update.mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    mocks.send.mockImplementation(async (input) => {
      await input.delivery.beforeSend();
      const rendered = renderVendorEmail(input);
      expect(rendered.text).toContain('A12 → B08');
      expect(rendered.html).toContain('https://mylawatan.example/vendor/events');
      return { id: 'smtp-test-only' };
    });
  });
  afterEach(() => vi.unstubAllEnvs());
  it('passes operational details and a trusted app link to the existing sender', async () => {
    expect(await processEmailOutbox(20)).toEqual({ sent: 1, failed: 0, reviewRequired: 0 });
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ eventChange: details, to: 'owner@example.test' }));
    expect(mocks.rpc).toHaveBeenCalledWith('finish_email_outbox_delivery', expect.objectContaining({ p_outcome: 'sent' }));
  });
  it('keeps a failed notice queued for a later bounded retry', async () => {
    mocks.send.mockRejectedValueOnce(new EmailDeliveryError(true));
    expect(await processEmailOutbox(20)).toEqual({ sent: 0, failed: 1, reviewRequired: 0 });
    expect(mocks.rpc).toHaveBeenCalledWith('finish_email_outbox_delivery', expect.objectContaining({ p_outcome: 'retry' }));
  });
  it('never converts accepted mail to retryable failure after lost acknowledgement', async () => {
    const original = mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation((name, args) => name === 'finish_email_outbox_delivery'
      ? Promise.resolve({ error: new Error('private database details') }) : original(name, args));
    await expect(processEmailOutbox()).rejects.toThrow('email_state_unavailable');
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'finish_email_outbox_delivery')
      .every(([, args]) => args.p_outcome === 'sent')).toBe(true);
  });
  it('reports unavailable instead of pretending failure recovery was persisted', async () => {
    const original = mocks.rpc.getMockImplementation()!;
    mocks.send.mockRejectedValueOnce(new EmailDeliveryError(true));
    mocks.rpc.mockImplementation((name, args) => name === 'finish_email_outbox_delivery'
      ? Promise.resolve({ error: new Error('private details') }) : original(name, args));
    await expect(processEmailOutbox()).rejects.toThrow('email_state_unavailable');
  });
  it('delivers an exception using the existing compatible email type and trusted order link', async () => {
    mocks.rpc.mockImplementation(async name => ({ data: name === 'claim_email_outbox_delivery' ? { rows: [{ id: 'exception-queue', lease_token: 'test-lease', to_email: 'owner@example.test', event_type: 'vendor_order_update',
      payload: { vendorName: 'Kitchen', reason: 'Pickup needs verification. ORD-123 · 2 × Cake', reference: 'ORD-123', occurredAt: '2026-10-12T00:00:00Z', actionPath: '/vendor/orders' } }], reviewRequired: 0 } : true, error: null }));
    mocks.send.mockImplementation(async (input) => {
      await input.delivery.beforeSend();
      const rendered = renderVendorEmail(input);
      expect(rendered.text).toContain('ORD-123');
      expect(rendered.html).toContain('href="https://mylawatan.example/vendor/orders"');
    });
    expect(await processEmailOutbox()).toEqual({ sent: 1, failed: 0, reviewRequired: 0 });
  });
  it('does not turn arbitrary stored action paths into email links', async () => {
    mocks.rpc.mockImplementation(async name => ({ data: name === 'claim_email_outbox_delivery' ? { rows: [{ id: 'exception-queue', lease_token: 'test-lease', to_email: 'owner@example.test', event_type: 'vendor_order_update',
      payload: { vendorName: 'Kitchen', reason: 'Needs verification', actionPath: '//evil.example/private' } }], reviewRequired: 0 } : true, error: null }));
    mocks.send.mockResolvedValue(undefined);
    expect(await processEmailOutbox()).toEqual({ sent: 1, failed: 0, reviewRequired: 0 });
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ actionUrl: undefined }));
  });
});
