import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { mfa: {} } }) }));
vi.mock('@/components/shared/language-switcher', () => ({ LanguageSwitcher: () => <button aria-label="Language">English</button> }));
vi.mock('@/components/customer/customer-site-footer', () => ({ CustomerSiteFooter: () => <footer data-site-footer="slim">Legal links</footer> }));
const { KycMfa } = await import('../kyc-mfa');
describe('KYC MFA entry', () => {
  it('reuses the original ceremony with staff-wide copy without generating any factor', () => {
    const html = renderToStaticMarkup(<KycMfa next="/admin/promotion-campaigns" scope="staff" />);
    expect(html).toContain('staffMfa.title');
    expect(html).toContain('data-brand-logo="mylawatan"');
    expect(html).toContain('data-site-footer="slim"');
    expect(html).toContain('aria-label="Language"');
    expect(html).not.toContain('var(--font-display)');
    expect((html.match(/<main/g) ?? []).length).toBe(1);
    expect((html.match(/<h1/g) ?? []).length).toBe(1);
    expect(html).toContain('kyc.mfa.start');
    expect(html).not.toContain('data:image');
    expect(html).not.toContain('otpauth');
  });
  it('renders an explicit user-initiated setup action without pre-generating a secret', () => {
    const html = renderToStaticMarkup(<KycMfa next="/admin/kyc" />);
    expect(html).toContain('kyc.mfa.start');
    expect(html).not.toContain('data-brand-logo="mylawatan"');
    expect(html).not.toContain('data:image');
    expect(html).not.toContain('otpauth');
  });
});
