import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("submit campaign vendor registration RPC boundary migration", () => {
  it("preserves the registration API behind authenticated and service role invoker access", () => {
    const sql = migration("private_submit_campaign_vendor_registration");
    const signature = "uuid, uuid, text, text, text, jsonb";

    expect(sql).toContain(`ALTER FUNCTION public.submit_campaign_vendor_registration(${signature}) SET SCHEMA app_private`);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.submit_campaign_vendor_registration\(\s*p_location_id uuid,\s*p_vendor_id uuid,\s*p_stall_number text,\s*p_stall_description text,\s*p_stall_poster_url text,\s*p_products jsonb\s*\)[\s\S]*?RETURNS uuid[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.submit_campaign_vendor_registration\(\s*p_location_id,\s*p_vendor_id,\s*p_stall_number,\s*p_stall_description,\s*p_stall_poster_url,\s*p_products\s*\)/i);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION app_private.submit_campaign_vendor_registration(${signature}) TO authenticated, service_role`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.submit_campaign_vendor_registration(${signature}) FROM PUBLIC, anon, service_role`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.submit_campaign_vendor_registration(${signature}) TO authenticated, service_role`);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
