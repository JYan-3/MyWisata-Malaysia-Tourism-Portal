import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("campaign vendor registration review RPC boundary migration", () => {
  it("preserves the optional note and staff review controls behind an invoker wrapper", () => {
    const sql = migration("private_review_campaign_vendor_registration");
    const signature = "uuid, text, text";

    expect(sql).toContain(`ALTER FUNCTION public.review_campaign_vendor_registration(${signature}) SET SCHEMA app_private`);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.review_campaign_vendor_registration\([\s\S]*?p_registration_id uuid,[\s\S]*?p_action text,[\s\S]*?p_note text DEFAULT NULL\s*\)[\s\S]*?RETURNS void[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.review_campaign_vendor_registration\([\s\S]*?p_registration_id,[\s\S]*?p_action,[\s\S]*?p_note\s*\)/i);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION app_private.review_campaign_vendor_registration(${signature}) TO authenticated, service_role`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.review_campaign_vendor_registration(${signature}) FROM PUBLIC, anon, service_role`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.review_campaign_vendor_registration(${signature}) TO authenticated, service_role`);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
