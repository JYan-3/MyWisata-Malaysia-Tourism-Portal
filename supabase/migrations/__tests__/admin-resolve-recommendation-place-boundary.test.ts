import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("recommendation place resolution RPC boundary migration", () => {
  it("preserves the nullable place argument, void result, and original grants", () => {
    const sql = migration("private_admin_resolve_recommendation_place");

    expect(sql).toMatch(/ALTER FUNCTION public\.admin_resolve_recommendation_place\(uuid, text, uuid\) SET SCHEMA app_private/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.admin_resolve_recommendation_place\(\s*p_rec_id uuid,\s*p_action text,\s*p_place_id uuid DEFAULT NULL::uuid\s*\)[\s\S]*?RETURNS void[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.admin_resolve_recommendation_place\(p_rec_id, p_action, p_place_id\)/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION app_private\.admin_resolve_recommendation_place\(uuid, text, uuid\) TO authenticated, service_role/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.admin_resolve_recommendation_place\(uuid, text, uuid\) FROM PUBLIC, anon, service_role/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.admin_resolve_recommendation_place\(uuid, text, uuid\) TO authenticated, service_role/i);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
