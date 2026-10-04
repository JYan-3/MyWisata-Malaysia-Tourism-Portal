import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("update campaign listing RPC boundary migration", () => {
  it("preserves owner and outlet-manager editing behind authenticated and service role invoker access", () => {
    const sql = migration("private_update_campaign_listing");
    const signature = "uuid, integer, boolean";

    expect(sql).toContain(`ALTER FUNCTION public.update_campaign_listing(${signature}) SET SCHEMA app_private`);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.update_campaign_listing\(\s*p_listing_id uuid,\s*p_daily_quantity integer,\s*p_active boolean\s*\)[\s\S]*?RETURNS jsonb[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.update_campaign_listing\(\s*p_listing_id,\s*p_daily_quantity,\s*p_active\s*\)/i);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION app_private.update_campaign_listing(${signature}) TO authenticated, service_role`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.update_campaign_listing(${signature}) FROM PUBLIC, anon, service_role`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.update_campaign_listing(${signature}) TO authenticated, service_role`);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
