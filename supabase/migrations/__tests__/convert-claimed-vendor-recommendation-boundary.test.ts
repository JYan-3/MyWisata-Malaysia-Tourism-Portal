import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("claimed vendor recommendation conversion RPC boundary migration", () => {
  it("preserves the conversion/reward transaction and authenticated API", () => {
    const sql = migration("private_convert_claimed_vendor_recommendation");

    expect(sql).toMatch(/ALTER FUNCTION public\.convert_claimed_vendor_recommendation\(uuid, uuid\) SET SCHEMA app_private/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.convert_claimed_vendor_recommendation\(\s*p_vendor_id uuid,\s*p_recommendation_id uuid\s*\)[\s\S]*?RETURNS uuid[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.convert_claimed_vendor_recommendation\(\s*p_vendor_id,\s*p_recommendation_id\s*\)/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION app_private\.convert_claimed_vendor_recommendation\(uuid, uuid\) TO authenticated, service_role/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.convert_claimed_vendor_recommendation\(uuid, uuid\) FROM PUBLIC, anon, service_role/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.convert_claimed_vendor_recommendation\(uuid, uuid\) TO authenticated, service_role/i);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
