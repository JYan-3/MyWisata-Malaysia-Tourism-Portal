import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const inboxSource = readFileSync(join(process.cwd(), 'app/vendor/inbox/page.tsx'), 'utf8');

describe('Vendor Inbox loading lifecycle', () => {
  it('uses the stable vendor ID rather than the rebuilt auth user object when loading threads', () => {
    expect(inboxSource).toContain("const vendorId = user?.activeVendorId;");
    expect(inboxSource).toContain("if (!vendorId) {");
    expect(inboxSource).toContain("if (showLoading) setLoading(false);");
    expect(inboxSource).toContain("}, [t, vendorId]);");
  });

  it('reconciles the inbox less often and only while visible', () => {
    expect(inboxSource).toContain('const INBOX_RECONCILE_POLL_MS = 15_000;');
    expect(inboxSource).toContain('document.visibilityState === \'visible\'');
    expect(inboxSource).toContain("document.addEventListener('visibilitychange', onVisibilityChange)");
  });

  it('prevents overlapping reads and keeps loaded threads after background failures', () => {
    expect(inboxSource).toContain('if (refreshRequest.current?.vendorId === vendorId) return;');
    expect(inboxSource).toContain('refreshRequest.current?.controller.abort();');
    expect(inboxSource).toContain('if (payload.error) {');
    expect(inboxSource).toContain('if (showLoading) {');
    expect(inboxSource).toContain('setThreads([]);');
  });
});
