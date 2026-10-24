import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const sql = readFileSync("supabase/migrations/20261023011427_complete_staff_access_governance.sql", "utf8");
describe("staff access governance completion", () => {
  it("provides governed current and remaining permission sources without deleting history", () => {
    expect(sql).toContain("public.get_staff_employee_access");
    expect(sql).toContain("p_excluded_assignment_id");
    expect(sql).toContain("public.require_active_global_staff_super_admin()");
    expect(sql).not.toMatch(/DELETE FROM public\.(users|withdrawal_approvals|audit_logs|staff_role_assignments)/i);
  });
  it("aligns rejection and recommendation review with module permissions", () => {
    expect(sql).toContain("admin.recommendation.review");
    expect(sql).toContain("reject_wallet_withdrawal_server");
    expect(sql).toContain("admin.withdrawal.approve");
  });
  it("closes direct browser role writes and preserves the final passkey boundary", () => {
    expect(sql).toMatch(/REVOKE INSERT, UPDATE, DELETE ON public.user_roles FROM anon, authenticated/i);
    expect(sql).toContain("staff_authority_assurance()");
  });
});
