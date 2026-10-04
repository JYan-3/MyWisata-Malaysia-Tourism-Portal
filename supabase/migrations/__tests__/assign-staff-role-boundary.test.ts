import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("staff role assignment RPC boundary migration", () => {
  it("preserves the super-admin assignment transaction and role grants", () => {
    const sql = migration("private_assign_staff_role");

    expect(sql).toMatch(/ALTER FUNCTION public\.assign_staff_role\(uuid, uuid, text\) SET SCHEMA app_private/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.assign_staff_role\(\s*p_role_id uuid,\s*p_user_id uuid,\s*p_reason text\s*\)[\s\S]*?RETURNS uuid[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.assign_staff_role\(\s*p_role_id,\s*p_user_id,\s*p_reason\s*\)/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION app_private\.assign_staff_role\(uuid, uuid, text\) TO authenticated, service_role/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.assign_staff_role\(uuid, uuid, text\) FROM PUBLIC, anon, service_role/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.assign_staff_role\(uuid, uuid, text\) TO authenticated, service_role/i);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
