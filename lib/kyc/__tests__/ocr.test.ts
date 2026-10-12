import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { runKycOcr } from '../ocr';

const originalKey = process.env.GOOGLE_AI_KEY;
const originalConsent = process.env.KYC_EXTERNAL_OCR_ENABLED;
const originalModel = process.env.GEMINI_OCR_MODEL;

const imageBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

function input(overrides: Partial<Parameters<typeof runKycOcr>[0]> = {}) {
  return {
    documentType: 'national_id' as const,
    enteredDocumentNumber: '900101-14-1234',
    front: { mimeType: 'image/jpeg', bytes: imageBytes },
    back: { mimeType: 'image/jpeg', bytes: imageBytes },
    hmacKey: 'test-hmac-key',
    ...overrides,
  };
}

function geminiResponse(text: string, ok = true, status = 200) {
  return new Response(JSON.stringify(ok ? { candidates: [{ content: { parts: [{ text }] } }] } : { error: { message: 'quota exhausted' } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  if (originalConsent === undefined) delete process.env.KYC_EXTERNAL_OCR_ENABLED;
  else process.env.KYC_EXTERNAL_OCR_ENABLED = originalConsent;
  if (originalKey === undefined) delete process.env.GOOGLE_AI_KEY;
  else process.env.GOOGLE_AI_KEY = originalKey;
  if (originalModel === undefined) delete process.env.GEMINI_OCR_MODEL;
  else process.env.GEMINI_OCR_MODEL = originalModel;
});

describe('runKycOcr', () => {
  it('never sends evidence to a provider without explicit operator opt-in', async () => {
    delete process.env.KYC_EXTERNAL_OCR_ENABLED;
    process.env.GOOGLE_AI_KEY = 'test-key';
    const fetch = vi.spyOn(globalThis, 'fetch');
    await expect(runKycOcr(input())).resolves.toMatchObject({ status: 'unavailable' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('records only a masked mismatching document number and no raw model text', async () => {
    process.env.KYC_EXTERNAL_OCR_ENABLED = 'true';
    process.env.GOOGLE_AI_KEY = 'test-key';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(geminiResponse(JSON.stringify({
      holderName: 'Aminah Ali', documentNumber: '900101-14-1235', expiryDate: null, confidence: 0.91, unreadable: false,
    })));

    const result = await runKycOcr(input());

    expect(result).toMatchObject({
      status: 'mismatch', holderName: 'Aminah Ali', documentNumberLast4: '1235', mismatchFields: ['document_number'], confidence: 0.91,
    });
    expect(result.documentNumberHmac).toMatch(/^[a-f0-9]{64}$/);
    expect(result).not.toHaveProperty('rawText');
    expect(result).not.toHaveProperty('documentNumber');
  });

  it('returns unavailable rather than throwing when Gemini rejects the request', async () => {
    process.env.KYC_EXTERNAL_OCR_ENABLED = 'true';
    process.env.GOOGLE_AI_KEY = 'test-key';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(geminiResponse('', false, 429));

    await expect(runKycOcr(input())).resolves.toMatchObject({ status: 'unavailable' });
  });
});
