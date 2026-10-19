import { describe, expect, it } from 'vitest';

// resolveCheckoutSubject is not under test here; only how an account's contact is built.
import { resolveCheckoutContact } from '../subject';

type Context = Parameters<typeof resolveCheckoutContact>[0];
const accountContext = (user: Record<string, unknown>) => ({ ok: true, subject: { kind: 'account' }, user }) as unknown as Context;

describe('account checkout contact', () => {
  it('works for a signed-in user whose auth account has no phone (Supabase returns "")', async () => {
    const contact = await resolveCheckoutContact(accountContext({ email: 'customer@demo.local', phone: '', user_metadata: {} }), undefined);
    expect(contact).toEqual({ email: 'customer@demo.local', name: null, phone: null });
  });

  it('uses a real auth phone and lets the request override it', async () => {
    expect((await resolveCheckoutContact(accountContext({ email: 'a@example.com', phone: '+60123456789', user_metadata: {} }), undefined))?.phone).toBe('+60123456789');
    expect((await resolveCheckoutContact(accountContext({ email: 'a@example.com', phone: '', user_metadata: {} }), { phone: '+60198765432' }))?.phone).toBe('+60198765432');
  });

  it('uses the name and email the signed-in user typed for this order, falling back to the account', async () => {
    const user = { email: 'a@example.com', phone: '', user_metadata: { full_name: 'Account Name' } };
    expect(await resolveCheckoutContact(accountContext(user), { email: 'other@example.com', name: 'Booking Name' }))
      .toEqual({ email: 'other@example.com', name: 'Booking Name', phone: null });
    expect(await resolveCheckoutContact(accountContext(user), {}))
      .toEqual({ email: 'a@example.com', name: 'Account Name', phone: null });
  });

  it('rejects an invalid typed email instead of silently using the account email', async () => {
    expect(await resolveCheckoutContact(accountContext({ email: 'a@example.com', phone: '', user_metadata: {} }), { email: 'not-an-email' })).toBeNull();
  });

  it('still rejects an account with no usable email', async () => {
    expect(await resolveCheckoutContact(accountContext({ email: '', phone: '', user_metadata: {} }), undefined)).toBeNull();
  });
});
