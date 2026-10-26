import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261025175421_catalogue_review_delivery_source_guard.sql"), "utf8");
const staffReview = readFileSync(resolve(process.cwd(), "supabase/migrations/20261023141512_approver_state_consistency.sql"), "utf8");
const vendorReview = readFileSync(resolve(process.cwd(), "app/api/vendors/[vendorId]/vouchers/[voucherId]/review/route.ts"), "utf8");

describe("catalogue review delivery source guard", () => {
  it("only creates owner delivery intents for normalized staff review decisions", () => {
    expect(migration).toMatch(/IF NEW\.action IS NULL OR NEW\.action NOT IN \('approved', 'rejected', 'change_requested'\) THEN\s+RETURN NEW;/i);
    expect(migration).toMatch(/SECURITY DEFINER SET search_path = ''/i);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION app_private\.queue_catalogue_review_notices\(\) FROM PUBLIC, anon, authenticated, service_role/i);
    expect(migration).toMatch(/ON CONFLICT\(event_key\) DO NOTHING/i);
  });

  it("distinguishes the existing staff and vendor voucher review action contracts", () => {
    expect(staffReview).toMatch(/VALUES \(p_entity_type, p_entity_id, v_vendor_id, v_actor_id, v_review_status/);
    expect(vendorReview).toContain("action: parsed.data.action");
    expect(vendorReview).toContain("z.enum(['approve', 'reject'])");
  });
});
