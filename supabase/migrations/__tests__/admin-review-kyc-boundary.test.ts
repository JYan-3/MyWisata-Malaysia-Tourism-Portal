import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("KYC review RPC boundary migration", () => {
  it("preserves both optional reason fields, void result, and auth/service access", () => {
    const sql = migration("private_admin_review_kyc");

    expect(sql).toMatch(/ALTER FUNCTION public\.admin_review_kyc\(uuid, uuid, text, text, text\) SET SCHEMA app_private/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.admin_review_kyc\([\s\S]*?p_reason_code text DEFAULT NULL::text,[\s\S]*?p_reason_detail text DEFAULT NULL::text[\s\S]*?\)[\s\S]*?RETURNS void[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.admin_review_kyc\(\s*p_submission_id,\s*p_user_id,\s*p_action,\s*p_reason_code,\s*p_reason_detail\s*\)/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION app_private\.admin_review_kyc\(uuid, uuid, text, text, text\) TO authenticated, service_role/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.admin_review_kyc\(uuid, uuid, text, text, text\) FROM PUBLIC, anon, service_role/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.admin_review_kyc\(uuid, uuid, text, text, text\) TO authenticated, service_role/i);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
