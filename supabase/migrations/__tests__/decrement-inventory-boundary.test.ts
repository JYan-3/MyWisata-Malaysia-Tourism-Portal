import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("inventory decrement RPC boundary migration", () => {
  it("limits stock changes to service role while preserving the legacy function API", () => {
    const sql = migration("private_decrement_inventory");
    const signature = "uuid, integer, uuid";

    expect(sql).toContain(`ALTER FUNCTION public.decrement_inventory(${signature}) SET SCHEMA app_private`);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.decrement_inventory\([\s\S]*?p_variant_id uuid,[\s\S]*?p_quantity integer,[\s\S]*?p_outlet_id uuid DEFAULT NULL[\s\S]*?\)[\s\S]*?RETURNS boolean[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.decrement_inventory\([\s\S]*?p_variant_id,[\s\S]*?p_quantity,[\s\S]*?p_outlet_id\s*\)/i);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION app_private.decrement_inventory(${signature}) FROM PUBLIC, anon, authenticated, service_role`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION app_private.decrement_inventory(${signature}) TO service_role`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.decrement_inventory(${signature}) FROM PUBLIC, anon, authenticated, service_role`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.decrement_inventory(${signature}) TO service_role`);
    expect(sql).not.toContain(`GRANT EXECUTE ON FUNCTION public.decrement_inventory(${signature}) TO authenticated`);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
