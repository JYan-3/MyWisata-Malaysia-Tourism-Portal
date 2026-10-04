import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("preference survey RPC boundary migration", () => {
  it("preserves survey defaults and the self/admin-guarded implementation", () => {
    const sql = migration("private_complete_preference_survey");

    expect(sql).toMatch(/ALTER FUNCTION public\.complete_preference_survey\(uuid, text\[\], text, text, boolean, integer, text\) SET SCHEMA app_private/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.complete_preference_survey\([\s\S]*?p_mobility_needs\s+text DEFAULT 'none'::text,[\s\S]*?p_pet_friendly\s+boolean DEFAULT false,[\s\S]*?p_preferred_radius_km\s+integer DEFAULT 20,[\s\S]*?p_notes\s+text DEFAULT NULL::text[\s\S]*?\)[\s\S]*?RETURNS void[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.complete_preference_survey\(\s*p_user_id,\s*p_interests,\s*p_budget_range,\s*p_mobility_needs,\s*p_pet_friendly,\s*p_preferred_radius_km,\s*p_notes\s*\)/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION app_private\.complete_preference_survey\(uuid, text\[\], text, text, boolean, integer, text\) TO authenticated, service_role/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.complete_preference_survey\(uuid, text\[\], text, text, boolean, integer, text\) FROM PUBLIC, anon/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.complete_preference_survey\(uuid, text\[\], text, text, boolean, integer, text\) TO authenticated, service_role/i);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
