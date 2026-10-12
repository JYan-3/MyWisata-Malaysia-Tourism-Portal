import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('supabase/migrations/20261012151337_enforce_server_only_kyc_storage.sql', 'utf8');

describe('KYC storage browser isolation', () => {
  it('denies all browser roles even when another permissive policy matches', () => {
    expect(sql).toMatch(/AS RESTRICTIVE\s+FOR ALL\s+TO anon, authenticated/i);
    expect(sql).toMatch(/USING \(bucket_id <> 'kyc-documents'\)/i);
    expect(sql).toMatch(/WITH CHECK \(bucket_id <> 'kyc-documents'\)/i);
  });
  it('preserves documents and other bucket policies', () => {
    expect(sql).not.toMatch(/DELETE FROM|UPDATE storage\.objects|DROP TABLE/i);
    expect(sql).not.toMatch(/TO service_role|FORCE ROW LEVEL SECURITY/i);
  });
});
