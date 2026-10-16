import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('supabase/migrations/20261015192354_kyc_prescreening_operations.sql', 'utf8');
describe('KYC operations database boundary', () => {
  it('requires fresh reviewer permission and AAL2 at the database entry points', () => {
    expect(sql).toContain('app_private.require_kyc_operations_reviewer');
    expect(sql).toContain('PERFORM app_private.require_kyc_aal2()');
    expect(sql).toContain("has_staff_permission(auth.uid(), 'admin.kyc.review')");
  });
  it('keeps precheck state separate and ties durable jobs to finalized evidence versions', () => {
    expect(sql).toContain('UNIQUE (submission_id, evidence_revision, rules_version)');
    expect(sql).toContain('CREATE TRIGGER enqueue_finalized_kyc_prescreening');
    expect(sql).toContain("OLD.status = 'draft' AND NEW.status = 'pending'");
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain('lease_token');
  });
  it('fences decisions and refuses the legacy unfenced reviewer API', () => {
    expect(sql).toContain('p_expected_version');
    expect(sql).toContain('kyc_assignment_changed');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.admin_review_kyc');
    expect(sql).toContain('FROM PUBLIC, anon, authenticated, service_role');
  });
});
