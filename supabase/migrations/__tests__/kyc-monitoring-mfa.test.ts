import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const migration = (name: string) => readFileSync(`supabase/migrations/${readdirSync('supabase/migrations').find(file => file.endsWith(`_${name}.sql`))}`, 'utf8');

describe('KYC security database boundaries', () => {
  it('requires assurance inside modern RPCs and reviewer reads while preserving own reads', () => {
    const sql = migration('kyc_reviewer_mfa_boundaries');
    expect(sql).toContain("auth.jwt() ->> 'aal'");
    expect(sql.match(/PERFORM app_private.require_kyc_aal2\(\)/g)).toHaveLength(2);
    expect(sql).toMatch(/user_id = \(SELECT auth.uid\(\)\)[\s\S]*'aal2'/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public.review_kyc[\s\S]*authenticated/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION app_private.review_kyc[\s\S]*authenticated/);
    expect(sql).not.toContain('CREATE OR REPLACE FUNCTION app_private.can_review_kyc');
    expect(sql).toContain('app_private.is_kyc_review_super_admin()');
    expect(sql).toContain("public.has_staff_permission(v_actor_id, 'admin.kyc.review')");
  });
  it('keeps monitoring records private and queues both alerts atomically with deduplication', () => {
    const sql = migration('kyc_security_monitoring');
    for (const table of ['kyc_purge_runs', 'kyc_security_incidents', 'kyc_security_state']) {
      expect(sql).toContain(`ALTER TABLE app_private.${table} ENABLE ROW LEVEL SECURITY`);
    }
    expect(sql).toContain("'account_security'");
    expect(sql).toContain("'kyc_security_alert'");
    expect(sql.match(/ON CONFLICT \(event_key\) DO NOTHING/g)?.length).toBeGreaterThanOrEqual(3);
    expect(sql).toContain("interval '26 hours'");
    expect(sql).toContain("interval '15 minutes'");
    expect(sql).toContain('count(DISTINCT entity_id)');
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(sql).toContain("interval '10 minutes'");
    expect(sql).toContain('v_count >= 10');
    expect(sql).toContain('IS DISTINCT FROM v_incident.actor_id');
    expect(sql).toMatch(/UPDATE public.email_outbox[\s\S]*event_type='kyc_security_alert'[\s\S]*status='sending'/);
  });
});
