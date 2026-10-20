import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyHumanChallenge } from '../human-verification';

describe('server human verification', () => {
  const fetcher = vi.fn();
  beforeEach(() => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'server-only-secret');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://mywisata.test');
    vi.stubEnv('TURNSTILE_ALLOWED_HOSTNAMES', '');
    fetcher.mockReset().mockResolvedValue(new Response(JSON.stringify({
      success: true, hostname: 'mywisata.test', action: 'phone_send',
    })));
  });
  afterEach(() => vi.unstubAllEnvs());

  it('rejects missing proof without contacting the provider', async () => {
    expect(await verifyHumanChallenge('', 'phone_send', fetcher)).toMatchObject({ ok: false, status: 403 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('accepts only the expected action and configured hostname', async () => {
    expect(await verifyHumanChallenge('proof', 'phone_send', fetcher)).toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledWith('https://challenges.cloudflare.com/turnstile/v0/siteverify', expect.objectContaining({
      method: 'POST', redirect: 'error', body: JSON.stringify({ secret: 'server-only-secret', response: 'proof' }),
    }));
  });
  it.each([
    { success: false, 'error-codes': ['timeout-or-duplicate'] },
    { success: true, hostname: 'attacker.test', action: 'phone_send' },
    { success: true, hostname: 'mywisata.test', action: 'signup' },
  ])('rejects expired, replayed or wrongly scoped proof: %j', async (body) => {
    fetcher.mockResolvedValue(new Response(JSON.stringify(body)));
    expect(await verifyHumanChallenge('proof', 'phone_send', fetcher)).toMatchObject({ ok: false, status: 403 });
  });
  it('fails closed on missing configuration and network failures without exposing secrets', async () => {
    fetcher.mockRejectedValue(new Error('private provider failure'));
    expect(await verifyHumanChallenge('proof', 'phone_send', fetcher)).toMatchObject({ ok: false, status: 503 });
    vi.stubEnv('TURNSTILE_SECRET_KEY', '');
    const result = await verifyHumanChallenge('proof', 'phone_send', fetcher);
    expect(result).toMatchObject({ ok: false, status: 503 });
    expect(JSON.stringify(result)).not.toMatch(/private provider|server-only-secret/);
  });

  it('does not accept the official testing secret in a production runtime', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('TURNSTILE_SECRET_KEY', '1x0000000000000000000000000000000AA');
    expect(await verifyHumanChallenge('proof', 'phone_send', fetcher)).toMatchObject({ ok: false, status: 503 });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
