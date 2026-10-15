import { beforeEach, describe, expect, it, vi } from 'vitest';

const reserveGuestRateLimit = vi.fn<(key: string, limit: number, seconds: number) => Promise<boolean>>(async () => true);
vi.mock('@/lib/checkout/guest-session', () => ({
  reserveGuestRateLimit: (...args: [string, number, number]) => reserveGuestRateLimit(...args),
  guestAddressRateKey: (request: Request) => `guest-address:${request.headers.get('x-test-address') ?? 'unavailable'}`,
}));

const { reserveAiQuota } = await import('@/lib/rate-limit/ai');

describe('reserveAiQuota', () => {
  beforeEach(() => reserveGuestRateLimit.mockClear());

  it('limits a signed-in user per feature over a 10-minute window', async () => {
    await reserveAiQuota(new Request('https://x.test'), 'chatbot', 'user-1');
    expect(reserveGuestRateLimit).toHaveBeenCalledWith('ai:chatbot:user:user-1', 30, 600);

    await reserveAiQuota(new Request('https://x.test'), 'chat-translate', 'user-1', 60);
    expect(reserveGuestRateLimit).toHaveBeenLastCalledWith('ai:chat-translate:user:user-1', 60, 600);
  });

  it('limits guests per trusted address, or all guests together when no address is trusted', async () => {
    await reserveAiQuota(new Request('https://x.test', { headers: { 'x-test-address': '203.0.113.9' } }), 'chatbot', null);
    expect(reserveGuestRateLimit).toHaveBeenLastCalledWith('ai:chatbot:guest-address:203.0.113.9', 10, 600);

    await reserveAiQuota(new Request('https://x.test'), 'chatbot', null);
    expect(reserveGuestRateLimit).toHaveBeenLastCalledWith('ai:chatbot:guest-address:unavailable', 100, 600);
  });

  it('reports over-limit callers', async () => {
    reserveGuestRateLimit.mockResolvedValueOnce(false);
    expect(await reserveAiQuota(new Request('https://x.test'), 'chatbot', 'user-1')).toBe(false);
  });
});
