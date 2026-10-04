import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("food-service checkout RPC boundary migration", () => {
  it("preserves food-mode validation and checkout delegation behind an invoker wrapper", () => {
    const sql = migration("private_prepare_checkout_food_modes");
    const signature = "uuid, uuid[], text, text, text, numeric, numeric, numeric, text, uuid, jsonb, jsonb";

    expect(sql).toContain(`ALTER FUNCTION public.prepare_checkout_with_food_service_modes(${signature}) SET SCHEMA app_private`);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.prepare_checkout_with_food_service_modes\([\s\S]*?p_cart_id uuid,[\s\S]*?p_claim_id uuid,[\s\S]*?p_lines jsonb,[\s\S]*?p_food_service_modes jsonb\s*\)[\s\S]*?RETURNS jsonb[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.prepare_checkout_with_food_service_modes\([\s\S]*?p_cart_id,[\s\S]*?p_claim_id,[\s\S]*?p_lines,[\s\S]*?p_food_service_modes\s*\)/i);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION app_private.prepare_checkout_with_food_service_modes(${signature}) TO authenticated, service_role`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.prepare_checkout_with_food_service_modes(${signature}) FROM PUBLIC, anon, service_role`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.prepare_checkout_with_food_service_modes(${signature}) TO authenticated, service_role`);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
