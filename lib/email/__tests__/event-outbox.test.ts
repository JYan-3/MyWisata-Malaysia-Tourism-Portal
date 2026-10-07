import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), update: vi.fn(), send: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({
  rpc: mocks.rpc, from: () => ({ update: mocks.update }),
}) }));
vi.mock('@/lib/email/sender', () => ({
  sendVendorEmail: mocks.send, sendAccountEmail: vi.fn(), sendRecommendationEmail: vi.fn(), sendTransactionEmail: vi.fn(),
}));
import { processEmailOutbox } from '@/lib/email/outbox';
import { renderVendorEmail } from '@/lib/email/templates';
const details = {
  eventTitle: 'Market', locationName: 'Main Hall', startsOn: '2026-11-01', endsOn: '2026-11-08',
  changes: [{ field: 'stallNumber', before: 'A12', after: 'B08' }], reason: 'New layout', actionPath: '/vendor/events',
};
describe('event notices through the existing durable sender', () => {
  beforeEach(() => {
    vi.resetAllMocks(); vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://mylawatan.example');
    mocks.rpc.mockResolvedValue({ data: [{ id: 'queue-fixture', to_email: 'owner@example.test',
      event_type: 'vendor_event_update', payload: { vendorName: 'Kitchen', reason: details.reason,
        occurredAt: '2026-10-07T03:00:00Z', eventChange: details } }], error: null });
    mocks.update.mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
    mocks.send.mockImplementation(async (input) => {
      const rendered = renderVendorEmail(input);
      expect(rendered.text).toContain('A12 → B08');
      expect(rendered.html).toContain('https://mylawatan.example/vendor/events');
      return { id: 'smtp-test-only' };
    });
  });
  afterEach(() => vi.unstubAllEnvs());
  it('passes operational details and a trusted app link to the existing sender', async () => {
    expect(await processEmailOutbox(20)).toEqual({ sent: 1, failed: 0 });
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ eventChange: details, to: 'owner@example.test' }));
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'sent' }));
  });
  it('keeps a failed notice queued for a later bounded retry', async () => {
    mocks.send.mockRejectedValueOnce(new Error('SMTP unavailable'));
    expect(await processEmailOutbox(20)).toEqual({ sent: 0, failed: 1 });
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', next_attempt_at: expect.any(String) }));
  });
});
