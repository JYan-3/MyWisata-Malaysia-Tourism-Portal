import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("entitlement access-control state RPC boundary migration", () => {
  it("preserves the super-admin-only JSONB read behind an invoker wrapper", () => {
    const sql = migration("private_list_entitlement_access_control_state");

    expect(sql).toMatch(/ALTER FUNCTION public\.list_entitlement_access_control_state\(\) SET SCHEMA app_private/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.list_entitlement_access_control_state\(\)[\s\S]*?RETURNS jsonb[\s\S]*?LANGUAGE sql[\s\S]*?STABLE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.list_entitlement_access_control_state\(\)/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION app_private\.list_entitlement_access_control_state\(\) TO authenticated/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.list_entitlement_access_control_state\(\) FROM PUBLIC, anon/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.list_entitlement_access_control_state\(\) TO authenticated/i);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });

  it("removes the default service-role grant absent from the original RPC", () => {
    const sql = migration("remove_service_role_from_list_entitlement_access_control_state");

    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.list_entitlement_access_control_state\(\) FROM service_role/i);
  });
});
