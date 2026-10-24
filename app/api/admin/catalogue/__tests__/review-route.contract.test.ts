import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "app/api/admin/catalogue/reviews/route.ts"), "utf8");
const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261023141512_approver_state_consistency.sql"), "utf8");

describe("Admin voucher review gate", () => {
  it("only queues and approves vouchers after Vendor Owner approval", () => {
    expect(migration).toContain("vendor_review_status = 'approved'");
    expect(source).toContain("list_catalogue_review_queue");
    expect(source).toContain("review_catalogue_item");
    expect(source).not.toContain(".update(update)");
  });

  it("uses the dynamic Catalogue Review permission guard", () => {
    expect(source).toContain('requireStaffPermission("admin.catalogue.review")');
    expect(source).not.toContain("names.includes('super_admin')");
  });
});
