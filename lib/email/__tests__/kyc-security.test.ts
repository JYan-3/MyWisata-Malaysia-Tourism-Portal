import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderKycSecurityEmail } from '../templates';

describe('KYC security email privacy', () => {
  beforeEach(() => vi.stubEnv('APP_URL', 'https://mylawatan.my'));
  it('renders fixed incident descriptions and a protected link without arbitrary metadata', () => {
    const result = renderKycSecurityEmail({ eventType: 'kyc_security_alert', kind: 'access_volume', count: 10, occurredAt: '2026-10-12T16:00:00Z', secret: 'private/customer/identity.jpg', reason: '990101-14-5678' } as never);
    expect(result.subject).toContain('KYC');
    expect(result.text).toContain('10');
    expect(result.html).toContain('/admin/kyc');
    expect(result.text).not.toContain('identity.jpg');
    expect(result.text).not.toContain('990101');
  });
  it('rejects unrecognised incident kinds instead of rendering arbitrary text', () => {
    expect(() => renderKycSecurityEmail({ eventType: 'kyc_security_alert', kind: 'private path', count: 1, occurredAt: '2026-10-12T16:00:00Z' } as never)).toThrow('Invalid KYC security alert');
  });
});
