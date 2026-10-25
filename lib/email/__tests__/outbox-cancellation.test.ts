import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  sendTransactionEmail: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock('@/lib/platform/operations-settings', () => ({
  isPlatformOperationEnabled: vi.fn(async () => false),
  PLATFORM_OPERATION_KEYS: { pauseCustomDelivery: 'pause' },
}));
vi.mock('../sender', () => ({
  sendAccountEmail: vi.fn(),
  sendRecommendationEmail: vi.fn(),
  sendTransactionEmail: mocks.sendTransactionEmail,
  sendVendorEmail: vi.fn(),
  sendKycSecurityEmail: vi.fn(),
}));
vi.mock('../order-receipt', () => ({ sendOrderReceiptEmail: vi.fn() }));
vi.mock('@/lib/checkout/order-pickup-passes', () => ({ loadOrderPickupPasses: vi.fn() }));
vi.mock('@/lib/payments/app-url', () => ({ resolvePaymentAppUrl: () => 'https://example.test' }));
vi.mock('../copy', () => ({
  emailCopy: () => ({ guest: 'Guest', standard: 'Standard', foodDineIn: 'Dine in', foodTakeaway: 'Takeaway' }),
  emailLocale: () => 'en',
  emailTime: (value: string) => value,
}));

import { processEmailOutbox } from '../outbox';

function query() {
  const q = {
    select: vi.fn(() => q),
    eq: vi.fn(() => q),
    maybeSingle: vi.fn(async () => ({ data: { status: 'cancelled' }, error: null })),
  };
  return q;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === 'claim_email_outbox_delivery_v2') return { data: { rows: [{ id: 'mail-1', user_id: null, to_email: 'old@example.test', event_type: 'topup_succeeded', payload: { reference: 'ref' }, status: 'sending', attempts: 1, lease_token: 'lease-1' }] }, error: null };
    if (name === 'begin_email_outbox_delivery') return { data: false, error: null };
    return { data: false, error: null };
  });
  mocks.from.mockImplementation(() => query());
  mocks.sendTransactionEmail.mockImplementation(async (input: { delivery: { beforeSend: () => Promise<void> } }) => {
    await input.delivery.beforeSend();
    return { id: 'smtp-1' };
  });
});

describe('cancelled Guest email leases', () => {
  it('does not call SMTP or retry a message fenced before SMTP begins', async () => {
    const result = await processEmailOutbox();
    expect(result).toEqual({ sent: 0, failed: 0, reviewRequired: 0 });
    expect(mocks.from).toHaveBeenCalledWith('email_outbox');
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).not.toHaveBeenCalledWith('finish_email_outbox_delivery', expect.anything());
  });
});
