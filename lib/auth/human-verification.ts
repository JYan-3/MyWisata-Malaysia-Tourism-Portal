import 'server-only';

type ChallengeResult = { ok: true } | {
  ok: false;
  code: 'HUMAN_VERIFICATION_REQUIRED' | 'HUMAN_VERIFICATION_FAILED' | 'HUMAN_VERIFICATION_UNAVAILABLE';
  status: 403 | 503;
};

export async function verifyHumanChallenge(
  token: string,
  action: string,
  fetcher: typeof fetch = fetch,
): Promise<ChallengeResult> {
  if (!token || token.length > 2048) return { ok: false, code: 'HUMAN_VERIFICATION_REQUIRED', status: 403 };
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  let hostnames: string[];
  try {
    hostnames = process.env.TURNSTILE_ALLOWED_HOSTNAMES?.split(',').map((host) => host.trim().toLowerCase()).filter(Boolean)
      ?? [new URL(process.env.NEXT_PUBLIC_SITE_URL ?? '').hostname.toLowerCase()];
    if (!hostnames.length) hostnames = [new URL(process.env.NEXT_PUBLIC_SITE_URL ?? '').hostname.toLowerCase()];
  } catch {
    return { ok: false, code: 'HUMAN_VERIFICATION_UNAVAILABLE', status: 503 };
  }
  if (!secret || (process.env.NODE_ENV === 'production' && /^[123]x0+/.test(secret))) {
    return { ok: false, code: 'HUMAN_VERIFICATION_UNAVAILABLE', status: 503 };
  }
  try {
    const response = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, response: token }),
      signal: AbortSignal.timeout(8_000),
      redirect: 'error',
    });
    if (!response.ok) return { ok: false, code: 'HUMAN_VERIFICATION_UNAVAILABLE', status: 503 };
    const body = await response.json() as { success?: boolean; hostname?: string; action?: string };
    if (body.success !== true || body.action !== action || !hostnames.includes(body.hostname?.toLowerCase() ?? '')) {
      return { ok: false, code: 'HUMAN_VERIFICATION_FAILED', status: 403 };
    }
    return { ok: true };
  } catch {
    return { ok: false, code: 'HUMAN_VERIFICATION_UNAVAILABLE', status: 503 };
  }
}
