import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("recommendation translation review RPC boundary migration", () => {
  it("preserves the super-admin-only void review API and both existing roles", () => {
    const sql = migration("private_admin_review_recommendation_translation");

    expect(sql).toMatch(/ALTER FUNCTION public\.admin_review_recommendation_translation\(uuid, uuid, text, text\) SET SCHEMA app_private/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.admin_review_recommendation_translation\([\s\S]*?RETURNS void[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.admin_review_recommendation_translation\(\s*p_translation_id,\s*p_rec_id,\s*p_translated_text,\s*p_status\s*\)/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION app_private\.admin_review_recommendation_translation\(uuid, uuid, text, text\) TO authenticated, service_role/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.admin_review_recommendation_translation\(uuid, uuid, text, text\) FROM PUBLIC, anon, service_role/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.admin_review_recommendation_translation\(uuid, uuid, text, text\) TO authenticated, service_role/i);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
