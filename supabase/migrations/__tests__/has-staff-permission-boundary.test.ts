import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("staff permission RPC boundary migration", () => {
  it("preserves caller-UID checks, service-role access, and the function result contract", () => {
    const sql = migration("private_has_staff_permission");

    expect(sql).toMatch(/ALTER FUNCTION public\.has_staff_permission\(uuid, text\) SET SCHEMA app_private/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.has_staff_permission\(p_user_id uuid, p_permission_key text\)[\s\S]*?RETURNS boolean[\s\S]*?STABLE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toContain("WHEN COALESCE(auth.role(), '') = 'service_role' THEN app_private.has_staff_permission(p_user_id, p_permission_key)");
    expect(sql).toContain("WHEN auth.uid() IS NOT NULL AND p_user_id = auth.uid() THEN app_private.has_staff_permission(p_user_id, p_permission_key)");
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION app_private\.has_staff_permission\(uuid, text\) TO authenticated, service_role/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.has_staff_permission\(uuid, text\) FROM PUBLIC, anon/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.has_staff_permission\(uuid, text\) TO authenticated, service_role/i);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
