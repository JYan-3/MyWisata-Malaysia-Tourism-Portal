import { describe, expect, it } from 'vitest';
import { getRequestId } from '@/lib/request-id';

describe('getRequestId', () => {
  it('uses the x-vercel-id header when present', () => {
    const request = new Request('https://example.com', { headers: { 'x-vercel-id': 'abc123' } });
    expect(getRequestId(request)).toBe('abc123');
  });

  it('falls back to a generated UUID when the header is absent', () => {
    const request = new Request('https://example.com');
    const id = getRequestId(request);
    expect(id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('generates a different fallback id per call', () => {
    const a = getRequestId(new Request('https://example.com'));
    const b = getRequestId(new Request('https://example.com'));
    expect(a).not.toBe(b);
  });
});
