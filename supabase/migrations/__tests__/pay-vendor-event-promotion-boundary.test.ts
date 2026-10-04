import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("vendor event promotion wallet payment RPC boundary migration", () => {
  it("preserves owner-bound wallet payment and its full transaction", () => {
    const sql = migration("private_pay_vendor_event_promotion_from_wallet");
    const signature = "uuid";

    expect(sql).toContain(`ALTER FUNCTION public.pay_vendor_event_promotion_from_wallet(${signature}) SET SCHEMA app_private`);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.pay_vendor_event_promotion_from_wallet\(\s*p_promotion_id uuid\s*\)[\s\S]*?RETURNS bigint[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.pay_vendor_event_promotion_from_wallet\(\s*p_promotion_id\s*\)/i);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION app_private.pay_vendor_event_promotion_from_wallet(${signature}) TO authenticated, service_role`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.pay_vendor_event_promotion_from_wallet(${signature}) FROM PUBLIC, anon, service_role`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.pay_vendor_event_promotion_from_wallet(${signature}) TO authenticated, service_role`);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
