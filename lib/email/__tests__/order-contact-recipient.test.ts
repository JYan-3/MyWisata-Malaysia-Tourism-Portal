import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  orderContactEmail: null as string | null,
  enqueueEmail: vi.fn(async () => undefined),
}));

vi.mock('@/lib/email/outbox', () => ({ enqueueEmail: mocks.enqueueEmail, processEmailOutbox: vi.fn(async () => undefined) }));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      const single = table === 'users'
        ? { data: { email: 'account@example.com', full_name: 'Account Holder' }, error: null }
        : { data: { contact_email: mocks.orderContactEmail }, error: null };
      const chain = { select: () => chain, eq: () => chain, single: async () => single, maybeSingle: async () => single };
      return chain;
    },
  }),
}));

const { enqueueUserTransactionEmail } = await import('@/lib/email/events');
const send = (orderId?: string) => enqueueUserTransactionEmail({
  eventKey: 'checkout:1', userId: 'user-1', eventType: 'checkout_succeeded', amountRm: 100, reference: 'order-1', orderId,
} as Parameters<typeof enqueueUserTransactionEmail>[0]);

describe('signed-in order email recipient', () => {
  beforeEach(() => mocks.enqueueEmail.mockClear());

  it('sends to the email typed at checkout for this order', async () => {
    mocks.orderContactEmail = 'booking@example.com';
    await send('order-1');
    expect(mocks.enqueueEmail).toHaveBeenCalledWith(expect.objectContaining({ toEmail: 'booking@example.com' }));
  });

  it('falls back to the account email when the order has none', async () => {
    mocks.orderContactEmail = null;
    await send('order-1');
    expect(mocks.enqueueEmail).toHaveBeenCalledWith(expect.objectContaining({ toEmail: 'account@example.com' }));
  });
});
