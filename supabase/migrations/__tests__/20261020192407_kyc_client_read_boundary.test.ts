import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20261020192407_kyc_client_read_boundary.sql', 'utf8');

describe('KYC client read boundary migration', () => {
  it('removes direct Data API access from client roles while preserving server access', () => {
    expect(migration).toMatch(/REVOKE ALL(?: PRIVILEGES)? ON TABLE public\.kyc_submissions FROM PUBLIC, anon, authenticated/i);
    expect(migration).not.toMatch(/REVOKE[^;]*FROM[^;]*service_role/i);
    expect(migration).not.toMatch(/GRANT[^;]*TO (?:anon|authenticated)/i);
  });

  it('does not change KYC rows, evidence, or the existing RLS policy', () => {
    expect(migration).not.toMatch(/INSERT INTO|UPDATE public\.kyc_submissions|DELETE FROM|DROP POLICY|DROP TABLE/i);
    expect(migration).toMatch(/ALTER TABLE public\.kyc_submissions ENABLE ROW LEVEL SECURITY/i);
  });
});
