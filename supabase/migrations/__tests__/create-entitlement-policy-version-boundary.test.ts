import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("entitlement policy version creation RPC boundary migration", () => {
  it("preserves the super-admin validation API and authenticated-only grant", () => {
    const sql = migration("private_create_entitlement_policy_version");

    expect(sql).toMatch(/ALTER FUNCTION public\.create_entitlement_policy_version\(uuid, text, timestamp with time zone, timestamp with time zone, jsonb, text\) SET SCHEMA app_private/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.create_entitlement_policy_version\(\s*p_policy_id uuid,\s*p_effect text,\s*p_effective_from timestamp with time zone,\s*p_effective_until timestamp with time zone,\s*p_requirements jsonb,\s*p_reason text\s*\)[\s\S]*?RETURNS uuid[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.create_entitlement_policy_version\(\s*p_policy_id,\s*p_effect,\s*p_effective_from,\s*p_effective_until,\s*p_requirements,\s*p_reason\s*\)/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION app_private\.create_entitlement_policy_version\(uuid, text, timestamp with time zone, timestamp with time zone, jsonb, text\) TO authenticated/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.create_entitlement_policy_version\(uuid, text, timestamp with time zone, timestamp with time zone, jsonb, text\) FROM PUBLIC, anon, service_role/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.create_entitlement_policy_version\(uuid, text, timestamp with time zone, timestamp with time zone, jsonb, text\) TO authenticated/i);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
