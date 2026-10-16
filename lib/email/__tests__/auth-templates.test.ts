import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('native Auth email language templates', () => {
  const kinds = ['confirmation','recovery','magic_link','invite','reauthentication','email_change'];
  it.each(kinds)('%s uses recipient metadata, all three languages and existing Auth tokens', kind => {
    const html = readFileSync(`supabase/templates/${kind}.html`, 'utf8');
    expect(html).toContain('.Data.preferred_locale "zh-CN"');
    expect(html).toContain('.Data.preferred_locale "ms"');
    expect(html).toContain('lang="zh-CN"');
    expect(html).toContain('lang="ms"');
    expect(html).toContain('lang="en"');
    expect(html).toContain('{{ .Token }}');
    if (kind !== 'reauthentication') expect(html).toContain('{{ .ConfirmationURL }}');
    expect(html).not.toMatch(/https:\/\/(?:api\.openai|generativelanguage)/);
  });
});
