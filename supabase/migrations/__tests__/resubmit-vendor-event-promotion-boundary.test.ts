import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("vendor event promotion resubmit RPC boundary migration", () => {
  it("preserves vendor ownership and resubmission state reset behind an invoker wrapper", () => {
    const sql = migration("private_resubmit_vendor_event_promotion");
    const signature = "uuid, text, text, date, date, text";

    expect(sql).toContain(`ALTER FUNCTION public.resubmit_vendor_event_promotion(${signature}) SET SCHEMA app_private`);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.resubmit_vendor_event_promotion\([\s\S]*?p_promotion_id uuid,[\s\S]*?p_title text,[\s\S]*?p_details text,[\s\S]*?p_starts_on date,[\s\S]*?p_ends_on date,[\s\S]*?p_poster_url text\s*\)[\s\S]*?RETURNS void[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.resubmit_vendor_event_promotion\([\s\S]*?p_promotion_id,[\s\S]*?p_title,[\s\S]*?p_details,[\s\S]*?p_starts_on,[\s\S]*?p_ends_on,[\s\S]*?p_poster_url\s*\)/i);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION app_private.resubmit_vendor_event_promotion(${signature}) TO authenticated, service_role`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.resubmit_vendor_event_promotion(${signature}) FROM PUBLIC, anon, service_role`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.resubmit_vendor_event_promotion(${signature}) TO authenticated, service_role`);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
