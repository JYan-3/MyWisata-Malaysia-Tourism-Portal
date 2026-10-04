import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("sponsored placement listing RPC boundary migration", () => {
  it("preserves the table-returning contract through an invoker wrapper", () => {
    const sql = migration("private_sponsored_placements_rpc");

    expect(sql).toMatch(/ALTER FUNCTION public\.list_active_sponsored_discovery_placements\(\) SET SCHEMA app_private/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.list_active_sponsored_discovery_placements\(\)\s*RETURNS TABLE\(\s*id uuid,\s*product_id uuid,\s*state text,\s*category_slug text,\s*starts_at (?:timestamp with time zone|timestamptz),\s*ends_at (?:timestamp with time zone|timestamptz),\s*priority integer,\s*status text\s*\)[\s\S]*?STABLE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toContain("FROM app_private.list_active_sponsored_discovery_placements()");
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION app_private\.list_active_sponsored_discovery_placements\(\) TO anon, authenticated, service_role/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.list_active_sponsored_discovery_placements\(\) FROM PUBLIC/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.list_active_sponsored_discovery_placements\(\) TO anon, authenticated, service_role/i);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
