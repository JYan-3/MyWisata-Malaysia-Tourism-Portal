import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const page = readFileSync(resolve(process.cwd(), 'app/admin/system-settings/page.tsx'), 'utf8');

describe('Admin System Settings page contract', () => {
  it('loads and saves only after the protected API succeeds', () => {
    expect(page).toContain("fetch('/api/admin/system-settings', { cache: 'no-store' })");
    expect(page).toContain("method: 'PATCH'");
    expect(page).toContain('setConfirmOpen(true)');
    expect(page).toContain('reason.trim().length < 10');
    expect(page).toContain('loadError ?');
  });

  it('makes the scope and existing-order and Auth-email exemptions visible', () => {
    expect(page).toContain('role="switch"');
    expect(page).toContain("t('ui.systemSettings.orders.existing')");
    expect(page).toContain("t('ui.systemSettings.email.authExemption')");
    expect(page).toContain("t('ui.systemSettings.impact.audit')");
  });
});
