import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("admin recommendation seen RPC boundary migration", () => {
  it("preserves the super-admin-gated implementation behind an invoker wrapper", () => {
    const sql = migration("private_mark_my_recommendations_seen");

    expect(sql).toMatch(/ALTER FUNCTION public\.mark_my_recommendations_seen\(\) SET SCHEMA app_private/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.mark_my_recommendations_seen\(\)[\s\S]*?RETURNS timestamp with time zone[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.mark_my_recommendations_seen\(\)/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION app_private\.mark_my_recommendations_seen\(\) TO authenticated, service_role/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.mark_my_recommendations_seen\(\) FROM PUBLIC, anon/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.mark_my_recommendations_seen\(\) TO authenticated, service_role/i);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
