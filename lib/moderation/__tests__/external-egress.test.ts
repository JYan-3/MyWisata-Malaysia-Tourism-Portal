import { afterEach, describe, expect, it, vi } from 'vitest';
import { moderateBio, moderateWalletReason } from '@/lib/moderation';

describe('moderation external egress', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('redacts Malaysian IC and phone values before sending profile text to Gemini', async () => {
    vi.stubEnv('GOOGLE_AI_KEY', 'test-key');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ flagged: false }) }] } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await moderateBio('990101-14-5678 +6012-3456789');
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body)) as { contents: { parts: { text: string }[] }[] };
    const outbound = body.contents[0].parts[0].text;

    expect(result).toEqual({ flagged: false });
    expect(outbound).not.toContain('990101-14-5678');
    expect(outbound).not.toContain('+6012-3456789');
    expect(outbound).toContain('[IC]');
    expect(outbound).toContain('[PHONE]');
  });

  it('blocks bank, KYC, and address context without making an external call', async () => {
    vi.stubEnv('GOOGLE_AI_KEY', 'test-key');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(moderateWalletReason('My bank account is 123456789012', 'hold', 'risk_review_required'))
      .resolves.toEqual({ error: 'sensitive_data_detected' });
    await expect(moderateBio('My home is 12 Jalan Merpati, George Town'))
      .resolves.toEqual({ error: 'sensitive_data_detected' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
