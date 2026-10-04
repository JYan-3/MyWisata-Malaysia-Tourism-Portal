import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("self-read RPC boundary migration", () => {
  it("keeps the existing result contracts and authenticated/service role access", () => {
    const sql = migration("private_self_read_rpcs");

    expect(sql).toMatch(/ALTER FUNCTION public\.get_my_roles\(\) SET SCHEMA app_private/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.get_my_roles\(\)[\s\S]*?RETURNS TABLE\(role_name character varying\)[\s\S]*?STABLE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toContain("SELECT * FROM app_private.get_my_roles()");

    expect(sql).toMatch(/ALTER FUNCTION public\.get_my_staff_access\(\) SET SCHEMA app_private/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.get_my_staff_access\(\)[\s\S]*?RETURNS jsonb[\s\S]*?STABLE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toContain("SELECT app_private.get_my_staff_access()");

    expect(sql).toMatch(/ALTER FUNCTION public\.get_my_unread_recommendation_count\(\) SET SCHEMA app_private/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.get_my_unread_recommendation_count\(\)[\s\S]*?RETURNS integer[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toContain("SELECT app_private.get_my_unread_recommendation_count()");

    for (const name of ["get_my_roles", "get_my_staff_access", "get_my_unread_recommendation_count"]) {
      expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION app_private\\.${name}\\(\\) TO authenticated, service_role`, "i"));
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\(\\) FROM PUBLIC, anon`, "i"));
      expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\(\\) TO authenticated, service_role`, "i"));
    }
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
