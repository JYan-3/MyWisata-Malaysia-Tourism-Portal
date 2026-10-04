import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("campaign vendor registration resubmit RPC boundary migration", () => {
  it("preserves vendor ownership and listing replacement behind an invoker wrapper", () => {
    const sql = migration("private_resubmit_campaign_vendor_registration");
    const signature = "uuid, text, text, text, jsonb";

    expect(sql).toContain(`ALTER FUNCTION public.resubmit_campaign_vendor_registration(${signature}) SET SCHEMA app_private`);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.resubmit_campaign_vendor_registration\([\s\S]*?p_registration_id uuid,[\s\S]*?p_stall_number text,[\s\S]*?p_stall_description text,[\s\S]*?p_stall_poster_url text,[\s\S]*?p_products jsonb\s*\)[\s\S]*?RETURNS void[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.resubmit_campaign_vendor_registration\([\s\S]*?p_registration_id,[\s\S]*?p_stall_number,[\s\S]*?p_stall_description,[\s\S]*?p_stall_poster_url,[\s\S]*?p_products\s*\)/i);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION app_private.resubmit_campaign_vendor_registration(${signature}) TO authenticated, service_role`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.resubmit_campaign_vendor_registration(${signature}) FROM PUBLIC, anon, service_role`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.resubmit_campaign_vendor_registration(${signature}) TO authenticated, service_role`);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
