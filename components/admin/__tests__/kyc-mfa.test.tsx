import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { mfa: {} } }) }));
const { KycMfa } = await import('../kyc-mfa');
describe('KYC MFA entry', () => {
  it('renders an explicit user-initiated setup action without pre-generating a secret', () => {
    const html = renderToStaticMarkup(<KycMfa next="/admin/kyc" />);
    expect(html).toContain('kyc.mfa.start');
    expect(html).not.toContain('data:image');
    expect(html).not.toContain('otpauth');
  });
});
