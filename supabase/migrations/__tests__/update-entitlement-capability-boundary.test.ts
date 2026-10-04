import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("update entitlement capability RPC boundary migration", () => {
  it("preserves the UUID governance API behind an authenticated-only invoker wrapper", () => {
    const sql = migration("private_update_entitlement_capability");
    const signature = "text, text, text, boolean, boolean, boolean, text";

    expect(sql).toContain(`ALTER FUNCTION public.update_entitlement_capability(${signature}) SET SCHEMA app_private`);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.update_entitlement_capability\([\s\S]*?p_capability_key text,[\s\S]*?p_category text,[\s\S]*?p_risk_level text,[\s\S]*?p_customer_visible boolean,[\s\S]*?p_manually_assignable boolean,[\s\S]*?p_enabled boolean,[\s\S]*?p_reason text\s*\)[\s\S]*?RETURNS uuid[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.update_entitlement_capability\([\s\S]*?p_capability_key,[\s\S]*?p_category,[\s\S]*?p_risk_level,[\s\S]*?p_customer_visible,[\s\S]*?p_manually_assignable,[\s\S]*?p_enabled,[\s\S]*?p_reason\s*\)/i);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION app_private.update_entitlement_capability(${signature}) TO authenticated`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.update_entitlement_capability(${signature}) FROM PUBLIC, anon, service_role`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.update_entitlement_capability(${signature}) TO authenticated`);
    expect(sql).not.toContain(`GRANT EXECUTE ON FUNCTION public.update_entitlement_capability(${signature}) TO authenticated, service_role`);
    expect(sql).not.toContain(`GRANT EXECUTE ON FUNCTION app_private.update_entitlement_capability(${signature}) TO authenticated, service_role`);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
