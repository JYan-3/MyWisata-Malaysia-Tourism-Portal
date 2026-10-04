import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("update staff role with modules RPC boundary migration", () => {
  it("preserves global role governance behind authenticated and service role invoker access", () => {
    const sql = migration("private_update_staff_role_with_modules");
    const signature = "uuid, text, text, text[], boolean, text";

    expect(sql).toContain(`ALTER FUNCTION public.update_staff_role_with_modules(${signature}) SET SCHEMA app_private`);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.update_staff_role_with_modules\(\s*p_role_id uuid,\s*p_name text,\s*p_description text,\s*p_module_keys text\[\],\s*p_active boolean,\s*p_reason text\s*\)[\s\S]*?RETURNS void[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.update_staff_role_with_modules\(\s*p_role_id,\s*p_name,\s*p_description,\s*p_module_keys,\s*p_active,\s*p_reason\s*\)/i);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION app_private.update_staff_role_with_modules(${signature}) TO authenticated, service_role`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.update_staff_role_with_modules(${signature}) FROM PUBLIC, anon, service_role`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.update_staff_role_with_modules(${signature}) TO authenticated, service_role`);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
