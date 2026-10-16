import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('signup email language boundary', () => {
  it.each(['app/login/page.tsx', 'app/staff-invitations/[token]/page.tsx', 'app/outlet-manager-invitations/[token]/page.tsx'])('%s passes the displayed selected locale to Auth before the first email', path => {
    const source = readFileSync(path, 'utf8');
    const signup = source.slice(source.indexOf('supabase.auth.signUp('), source.indexOf('supabase.auth.signUp(') + 550);
    expect(signup).toContain('preferred_locale: resolveAppLocale({ accountLocale: i18n.resolvedLanguage })');
    expect(signup).not.toMatch(/app_metadata|role\s*:/);
  });
});
