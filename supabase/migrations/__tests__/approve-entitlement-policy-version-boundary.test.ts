import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("entitlement policy approval RPC boundary migration", () => {
  it("preserves the super-admin approval API and authenticated-only grant", () => {
    const sql = migration("private_approve_entitlement_policy_version");

    expect(sql).toMatch(/ALTER FUNCTION public\.approve_entitlement_policy_version\(uuid, text\) SET SCHEMA app_private/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.approve_entitlement_policy_version\(\s*p_version_id uuid,\s*p_reason text\s*\)[\s\S]*?RETURNS void[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.approve_entitlement_policy_version\(\s*p_version_id,\s*p_reason\s*\)/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION app_private\.approve_entitlement_policy_version\(uuid, text\) TO authenticated/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.approve_entitlement_policy_version\(uuid, text\) FROM PUBLIC, anon, service_role/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.approve_entitlement_policy_version\(uuid, text\) TO authenticated/i);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
