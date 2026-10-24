import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20261020192613_kyc_safe_profile_metadata_columns.sql', 'utf8');

describe('KYC profile metadata compatibility migration', () => {
  it('grants authenticated users only the safe profile summary columns', () => {
    expect(migration).toMatch(/GRANT SELECT\s*\(\s*user_id\s*,\s*status\s*,\s*review_reason_code\s*,\s*reviewed_at\s*,\s*created_at\s*\)\s*ON TABLE public\.kyc_submissions TO authenticated/i);
    expect(migration).not.toMatch(/GRANT SELECT ON TABLE public\.kyc_submissions TO authenticated/i);
    expect(migration).not.toMatch(/document_url|ic_hash/i);
    expect(migration).not.toMatch(/TO anon|TO PUBLIC/i);
  });

  it('does not grant write access or change KYC data and policies', () => {
    expect(migration).not.toMatch(/GRANT\s+(?:INSERT|UPDATE|DELETE|ALL)|INSERT INTO|UPDATE public\.kyc_submissions|DELETE FROM|DROP POLICY|DROP TABLE/i);
  });
});
