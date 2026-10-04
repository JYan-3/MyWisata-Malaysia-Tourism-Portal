import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("KYC draft abandonment RPC boundary migration", () => {
  it("preserves the boolean cleanup contract and owner-scoped private implementation", () => {
    const sql = migration("private_abandon_kyc_submission");

    expect(sql).toMatch(/ALTER FUNCTION public\.abandon_kyc_submission\(uuid\) SET SCHEMA app_private/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.abandon_kyc_submission\(p_submission_id uuid\)[\s\S]*?RETURNS boolean[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.abandon_kyc_submission\(p_submission_id\)/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION app_private\.abandon_kyc_submission\(uuid\) TO authenticated, service_role/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.abandon_kyc_submission\(uuid\) FROM PUBLIC, anon/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.abandon_kyc_submission\(uuid\) TO authenticated, service_role/i);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
