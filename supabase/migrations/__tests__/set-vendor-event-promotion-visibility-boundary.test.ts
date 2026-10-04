import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("set vendor event promotion visibility RPC boundary migration", () => {
  it("preserves pause/resume controls behind authenticated and service role invoker access", () => {
    const sql = migration("private_set_vendor_event_promotion_visibility");
    const signature = "uuid, text";

    expect(sql).toContain(`ALTER FUNCTION public.set_vendor_event_promotion_visibility(${signature}) SET SCHEMA app_private`);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.set_vendor_event_promotion_visibility\(\s*p_promotion_id uuid,\s*p_action text\s*\)[\s\S]*?RETURNS void[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.set_vendor_event_promotion_visibility\(\s*p_promotion_id,\s*p_action\s*\)/i);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION app_private.set_vendor_event_promotion_visibility(${signature}) TO authenticated, service_role`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.set_vendor_event_promotion_visibility(${signature}) FROM PUBLIC, anon, service_role`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.set_vendor_event_promotion_visibility(${signature}) TO authenticated, service_role`);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
