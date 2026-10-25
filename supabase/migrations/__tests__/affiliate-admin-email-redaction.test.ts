import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../20261025093216_redact_affiliate_admin_email_fallbacks.sql', import.meta.url),
  'utf8',
);
const fraudQueueMigration = readFileSync(
  new URL('../20261025093457_redact_affiliate_fraud_queue_email.sql', import.meta.url),
  'utf8',
);

describe('affiliate admin email redaction migration', () => {
  it('does not use email as a display-name or search fallback', () => {
    expect(migration).not.toMatch(/users\.email/i);
    expect(migration.match(/coalesce\(nullif\(trim\(users\.full_name\)/gi)).toHaveLength(5);
  });

  it('retains service-only access to admin aggregate RPCs', () => {
    expect(migration.match(/REVOKE ALL ON FUNCTION public\./g)).toHaveLength(3);
    expect(migration.match(/GRANT EXECUTE ON FUNCTION public\..* TO service_role/g)).toHaveLength(3);
    expect(migration).not.toMatch(/GRANT EXECUTE ON FUNCTION public\..* TO authenticated/i);
  });

  it('also removes raw email from the fraud queue display and search', () => {
    expect(fraudQueueMigration).not.toMatch(/u\.email/i);
    expect(fraudQueueMigration).toMatch(/COALESCE\(NULLIF\(trim\(u\.full_name\)/i);
    expect(fraudQueueMigration).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_affiliate_fraud_flag_page.* TO service_role/i);
  });
});
