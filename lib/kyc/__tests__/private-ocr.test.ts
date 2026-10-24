import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runKycOcr, kycOcrRuntimeConfiguration } from '../ocr';

const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const input = () => ({ documentType: 'national_id' as const, enteredDocumentNumber: '900101-14-1234',
  front: { mimeType: 'image/jpeg', bytes }, back: { mimeType: 'image/jpeg', bytes }, hmacKey: 'test-hmac-key' });
beforeEach(() => {
  vi.stubEnv('KYC_PRIVATE_OCR_URL', '');
  vi.stubEnv('KYC_PRIVATE_OCR_TOKEN', '');
  vi.stubEnv('KYC_PRIVATE_OCR_TIMEOUT_MS', '');
  vi.stubEnv('KYC_EXTERNAL_OCR_ENABLED', 'true');
  vi.stubEnv('GOOGLE_AI_KEY', 'legacy-key');
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
function configure(url = 'http://127.0.0.1:8091/ocr') {
  vi.stubEnv('KYC_PRIVATE_OCR_URL', url);
  vi.stubEnv('KYC_PRIVATE_OCR_TOKEN', 'private-test-token');
  vi.stubEnv('KYC_PRIVATE_OCR_TIMEOUT_MS', '20000');
}

describe('private-only KYC OCR', () => {
  it('never sends evidence using the legacy external opt-in, even with an AI key', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    expect(await runKycOcr(input())).toMatchObject({ status: 'unavailable' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['https://generativelanguage.googleapis.com/ocr', 'http://10.0.0.1/ocr',
    'https://example.com/ocr', 'http://169.254.169.254/ocr', 'http://user:pass@127.0.0.1/ocr']) (
    'rejects unsafe endpoint %s without sending bytes', async (url) => {
      configure(url);
      const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
      expect(await runKycOcr(input())).toMatchObject({ status: 'unavailable' });
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it('authenticates to private OCR without sending the entered identifier and stores only masked output', async () => {
    configure();
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      holderName: 'Aminah Ali', documentNumber: '900101-14-1235', expiryDate: null,
      confidence: 0.91, unreadable: false,
    })));
    const output = await runKycOcr(input());
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:8091/ocr', expect.objectContaining({ redirect: 'error',
      headers: expect.objectContaining({ authorization: 'Bearer private-test-token' }) }));
    expect(String(fetch.mock.calls[0][1]?.body)).not.toContain('900101-14-1234');
    expect(output).toMatchObject({ status: 'mismatch', documentNumberLast4: '1235', mismatchFields: ['document_number'] });
    expect(output.documentNumberHmac).toMatch(/^[a-f0-9]{64}$/);
    expect(output).not.toHaveProperty('documentNumber');
    expect(output).not.toHaveProperty('rawText');
  });
  it('falls back to manual review on private service failure', async () => {
    configure();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('private URL and bytes must not leak'));
    expect(await runKycOcr(input())).toMatchObject({ status: 'unavailable', mismatchFields: [] });
  });
});


describe('bounded OCR failure categories', () => {
  it.each([[401, false, 'service_auth'], [422, false, 'service_rejected'], [429, true, 'service_unavailable'], [503, true, 'service_unavailable']])('classifies HTTP %s without logging the body', async (status, retryable, failureCode) => {
    configure();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('private details', { status: Number(status) }));
    expect(await runKycOcr(input())).toMatchObject({status:'unavailable',retryable,failureCode});
  });
  it('does not retry readable responses whose document is unreadable', async () => {
    configure(); vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({unreadable:true}));
    expect(await runKycOcr(input())).toMatchObject({status:'unreadable'});
  });
});


describe('explicit local engine configuration', () => {
  it('does not require a private URL/token for the local engine', () => {
    vi.stubEnv('KYC_OCR_ENGINE', 'tesseract-js'); vi.stubEnv('KYC_NODE_OCR_TIMEOUT_MS', '20000');
    expect(kycOcrRuntimeConfiguration()).toEqual({ engine: 'tesseract-js', timeoutMs: 20000 });
  });
  it('never falls back when an engine is misspelled', async () => {
    configure(); vi.stubEnv('KYC_OCR_ENGINE', 'typo');
    const fetch = vi.spyOn(globalThis, 'fetch');
    expect(await runKycOcr(input())).toMatchObject({ status: 'unavailable' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
