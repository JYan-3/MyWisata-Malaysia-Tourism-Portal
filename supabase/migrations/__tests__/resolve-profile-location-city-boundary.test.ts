import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("profile location resolver RPC boundary migration", () => {
  it("keeps the canonical city lookup contract behind an invoker wrapper", () => {
    const sql = migration("private_resolve_profile_location_city");

    expect(sql).toMatch(/ALTER FUNCTION public\.resolve_profile_location_city\(uuid, text\) SET SCHEMA app_private/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.resolve_profile_location_city\(\s*p_city_id uuid,\s*p_country_code text\s*\)[\s\S]*?RETURNS TABLE\s*\(\s*id uuid,\s*name text,\s*country_code text\s*\)[\s\S]*?LANGUAGE sql[\s\S]*?STABLE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/FROM app_private\.resolve_profile_location_city\(p_city_id, p_country_code\)/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION app_private\.resolve_profile_location_city\(uuid, text\) TO authenticated, service_role/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.resolve_profile_location_city\(uuid, text\) FROM PUBLIC, anon/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.resolve_profile_location_city\(uuid, text\) TO authenticated, service_role/i);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
