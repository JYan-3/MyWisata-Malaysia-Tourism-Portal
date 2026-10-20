import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { resolvedLanguage: 'en' } }) }));
import { HumanVerification } from '../human-verification';

describe('managed verification configuration', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('shows an unavailable state when no site key is configured', () => {
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', '');
    const html = renderToStaticMarkup(<HumanVerification action="phone_send" resetKey={0} onToken={vi.fn()} />);
    expect(html).toContain('humanVerification.unavailable');
    expect(html).toContain('role="alert"');
  });
  it('never exposes the server secret in rendered markup', () => {
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'public-key');
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'private-secret');
    const html = renderToStaticMarkup(<HumanVerification action="phone_send" resetKey={0} onToken={vi.fn()} />);
    expect(html).not.toContain('private-secret');
    expect(html).not.toContain('humanVerification.unavailable');
  });
});
