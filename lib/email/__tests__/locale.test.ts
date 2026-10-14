import { describe, expect, it } from 'vitest';
import { checkoutEmailLocale, recipientEmailLocale } from '../locale';

describe('recipient-owned email locale', () => {
  it('uses the selected Guest cookie and never the payment callback/browser language', () => {
    expect(checkoutEmailLocale(new Request('https://example.test', { headers: { cookie: 'NEXT_LOCALE=zh-CN', 'accept-language': 'ms' } }))).toBe('zh-CN');
    expect(checkoutEmailLocale(new Request('https://example.test', { headers: { 'accept-language': 'zh-CN' } }))).toBe('en');
    expect(checkoutEmailLocale(new Request('https://example.test', { headers: { cookie: 'NEXT_LOCALE=%broken' } }))).toBe('en');
  });
  it('looks up the actual destination, supports no-account English, and does not hide lookup failures', async () => {
    const db = (data: unknown, error: unknown = null) => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data, error }) }) }) }) });
    expect(await recipientEmailLocale(db({ preferred_locale: 'zh-CN' }) as never, 'recipient@example.test')).toBe('zh-CN');
    expect(await recipientEmailLocale(db(null) as never, 'new@example.test')).toBe('en');
    await expect(recipientEmailLocale(db(null, {}) as never, 'recipient@example.test')).rejects.toThrow('email_recipient_locale_unavailable');
  });
});
