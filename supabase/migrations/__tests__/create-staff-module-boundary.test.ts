import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("staff module creation RPC boundary migration", () => {
  it("preserves global super-admin validation and the full module API", () => {
    const sql = migration("private_create_staff_module");
    const signature = "text, text, text, text, text, text, text, integer, text, text, integer, text[], text, text";

    expect(sql).toContain(`ALTER FUNCTION public.create_staff_module(${signature}) SET SCHEMA app_private`);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.create_staff_module\([\s\S]*?p_permission_keys text\[\],[\s\S]*?p_group_key text,[\s\S]*?p_reason text\s*\)[\s\S]*?RETURNS uuid[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.create_staff_module\([\s\S]*?p_permission_keys,[\s\S]*?p_group_key,[\s\S]*?p_reason\s*\)/i);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION app_private.create_staff_module(${signature}) TO authenticated, service_role`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.create_staff_module(${signature}) FROM PUBLIC, anon, service_role`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.create_staff_module(${signature}) TO authenticated, service_role`);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
