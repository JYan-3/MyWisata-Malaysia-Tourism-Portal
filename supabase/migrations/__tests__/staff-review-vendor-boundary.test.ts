import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("staff review vendor RPC boundary migration", () => {
  it("preserves vendor review outcomes behind authenticated and service role invoker access", () => {
    const sql = migration("private_staff_review_vendor");
    const signature = "uuid, text, text";

    expect(sql).toContain(`ALTER FUNCTION public.staff_review_vendor(${signature}) SET SCHEMA app_private`);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.staff_review_vendor\(\s*p_vendor_id uuid,\s*p_action text,\s*p_reason text\s*\)[\s\S]*?RETURNS jsonb[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.staff_review_vendor\(\s*p_vendor_id,\s*p_action,\s*p_reason\s*\)/i);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION app_private.staff_review_vendor(${signature}) TO authenticated, service_role`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.staff_review_vendor(${signature}) FROM PUBLIC, anon, service_role`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.staff_review_vendor(${signature}) TO authenticated, service_role`);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
