import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("base checkout RPC boundary migration", () => {
  it("preserves the existing checkout implementation behind an invoker wrapper", () => {
    const sql = migration("private_prepare_checkout_base");
    const signature = "uuid, uuid[], text, text, text, numeric, numeric, numeric, text, jsonb";

    expect(sql).toContain(`ALTER FUNCTION public.prepare_checkout(${signature}) SET SCHEMA app_private`);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.prepare_checkout\([\s\S]*?p_cart_id uuid,[\s\S]*?p_selected_item_ids uuid\[\],[\s\S]*?p_voucher_code text,[\s\S]*?p_lines jsonb\s*\)[\s\S]*?RETURNS jsonb[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.prepare_checkout\([\s\S]*?p_cart_id,[\s\S]*?p_selected_item_ids,[\s\S]*?p_voucher_code,[\s\S]*?p_lines\s*\)/i);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION app_private.prepare_checkout(${signature}) TO authenticated, service_role`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.prepare_checkout(${signature}) FROM PUBLIC, anon, service_role`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.prepare_checkout(${signature}) TO authenticated, service_role`);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
