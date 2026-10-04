import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("promotion campaign location deletion RPC boundary migration", () => {
  it("preserves staff permission checks and location deletion guards", () => {
    const sql = migration("private_delete_promotion_campaign_location");
    const signature = "uuid";

    expect(sql).toContain(`ALTER FUNCTION public.delete_promotion_campaign_location(${signature}) SET SCHEMA app_private`);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.delete_promotion_campaign_location\(\s*p_location_id uuid\s*\)[\s\S]*?RETURNS void[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.delete_promotion_campaign_location\(\s*p_location_id\s*\)/i);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION app_private.delete_promotion_campaign_location(${signature}) TO authenticated, service_role`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.delete_promotion_campaign_location(${signature}) FROM PUBLIC, anon, service_role`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.delete_promotion_campaign_location(${signature}) TO authenticated, service_role`);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
