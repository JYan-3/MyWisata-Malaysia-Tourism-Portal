import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("collaborative recommendation RPC boundary migration", () => {
  it("restricts signed-in lookups to self and preserves trusted service calls", () => {
    const sql = migration("private_collaborative_recommendations");

    expect(sql).toMatch(/ALTER FUNCTION public\.collaborative_recommendations\(uuid, integer\) SET SCHEMA app_private/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.collaborative_recommendations\([\s\S]*?p_user_id uuid,[\s\S]*?p_limit integer DEFAULT 20[\s\S]*?\)[\s\S]*?RETURNS TABLE\s*\(\s*product_id uuid,\s*score numeric\s*\)[\s\S]*?STABLE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/IF COALESCE\(auth\.role\(\), ''\) <> 'service_role'[\s\S]*?auth\.uid\(\) IS DISTINCT FROM p_user_id/i);
    expect(sql).toMatch(/RETURN QUERY\s+SELECT \*\s+FROM app_private\.collaborative_recommendations\(p_user_id, p_limit\)/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION app_private\.collaborative_recommendations\(uuid, integer\) TO authenticated, service_role/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.collaborative_recommendations\(uuid, integer\) FROM PUBLIC, anon/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.collaborative_recommendations\(uuid, integer\) TO authenticated, service_role/i);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
