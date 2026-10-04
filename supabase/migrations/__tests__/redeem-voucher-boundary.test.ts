import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("voucher redemption RPC boundary migration", () => {
  it("preserves customer ownership and redemption limits behind an invoker wrapper", () => {
    const sql = migration("private_redeem_voucher");
    const signature = "uuid, uuid, uuid, numeric";

    expect(sql).toContain(`ALTER FUNCTION public.redeem_voucher(${signature}) SET SCHEMA app_private`);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.redeem_voucher\([\s\S]*?p_voucher_id uuid,[\s\S]*?p_order_id uuid,[\s\S]*?p_user_id uuid,[\s\S]*?p_discount numeric\s*\)[\s\S]*?RETURNS boolean[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.redeem_voucher\([\s\S]*?p_voucher_id,[\s\S]*?p_order_id,[\s\S]*?p_user_id,[\s\S]*?p_discount\s*\)/i);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION app_private.redeem_voucher(${signature}) TO authenticated, service_role`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.redeem_voucher(${signature}) FROM PUBLIC, anon, service_role`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.redeem_voucher(${signature}) TO authenticated, service_role`);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
