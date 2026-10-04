import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("location city search RPC boundary migration", () => {
  it("keeps the catalogue search contract and ACLs behind an invoker wrapper", () => {
    const sql = migration("private_location_city_search_rpc");

    expect(sql).toMatch(/ALTER FUNCTION public\.search_location_cities\(text, text, integer\) SET SCHEMA app_private/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.search_location_cities\(\s*p_country_code text,\s*p_query text,\s*p_limit integer DEFAULT 5\s*\)[\s\S]*?RETURNS TABLE \(\s*id uuid,\s*name text,\s*admin1_code text,\s*country_code text\s*\)[\s\S]*?LANGUAGE sql[\s\S]*?STABLE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/FROM app_private\.search_location_cities\(p_country_code, p_query, p_limit\)/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION app_private\.search_location_cities\(text, text, integer\) TO authenticated, service_role/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.search_location_cities\(text, text, integer\) FROM PUBLIC, anon/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.search_location_cities\(text, text, integer\) TO authenticated, service_role/i);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
