import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = ['20261014194135_staff_passkey_authorization.sql', '20261014194717_staff_passkey_boundaries.sql'].map(file => readFileSync(resolve(process.cwd(), `supabase/migrations/${file}`), 'utf8')).join('\n');
describe('staff Passkey database trust boundary', () => {
  it('keeps all trust records private and client writes revoked', () => {
    for (const table of ['staff_passkey_credentials', 'staff_passkey_challenges', 'staff_session_assurance', 'staff_passkey_enrollment_grants', 'withdrawal_authorization_proofs']) {
      expect(sql).toContain(`CREATE TABLE app_private.${table}`);
      expect(sql).toContain(`ALTER TABLE app_private.${table} ENABLE ROW LEVEL SECURITY`);
    }
    expect(sql).toContain('FROM PUBLIC, anon, authenticated');
    expect(sql).toContain('REVOKE ALL ON TABLE app_private.staff_passkey_credentials');
  });
  it('checks live session, active staff, password provenance and credential revocation', () => {
    for (const fragment of ['auth.sessions', 'auth.mfa_amr_claims', "authentication_method = 'password'", "status = 'active'", 'revoked_at IS NULL', 'not_after', "auth.jwt()->>'session_id'"]) expect(sql).toContain(fragment);
  });
  it('locks and consumes challenges and proofs with expiry and transaction binding', () => {
    for (const fragment of ['FOR UPDATE', 'consumed_at IS NULL', "INTERVAL '2 minutes'", 'approval_cycle', 'destination_provider_reference', 'p_payload', 'p_session_id', 'proof_required']) expect(sql).toContain(fragment);
  });
});
