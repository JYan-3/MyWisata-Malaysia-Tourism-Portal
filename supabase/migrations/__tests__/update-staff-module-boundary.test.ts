import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("update staff module RPC boundary migration", () => {
  it("preserves the complete module API behind authenticated and service role invoker access", () => {
    const sql = migration("private_update_staff_module");
    const signature = "uuid, text, text, text, text, text, text, integer, text, text, integer, text[], text, boolean, text";

    expect(sql).toContain(`ALTER FUNCTION public.update_staff_module(${signature}) SET SCHEMA app_private`);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.update_staff_module\([\s\S]*?p_module_id uuid,[\s\S]*?p_label text,[\s\S]*?p_label_key text,[\s\S]*?p_description text,[\s\S]*?p_section_key text,[\s\S]*?p_section_label text,[\s\S]*?p_section_label_key text,[\s\S]*?p_section_sort_order integer,[\s\S]*?p_href text,[\s\S]*?p_icon_key text,[\s\S]*?p_sort_order integer,[\s\S]*?p_permission_keys text\[\],[\s\S]*?p_group_key text,[\s\S]*?p_active boolean,[\s\S]*?p_reason text\s*\)[\s\S]*?RETURNS void[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.update_staff_module\([\s\S]*?p_module_id,[\s\S]*?p_label,[\s\S]*?p_label_key,[\s\S]*?p_description,[\s\S]*?p_section_key,[\s\S]*?p_section_label,[\s\S]*?p_section_label_key,[\s\S]*?p_section_sort_order,[\s\S]*?p_href,[\s\S]*?p_icon_key,[\s\S]*?p_sort_order,[\s\S]*?p_permission_keys,[\s\S]*?p_group_key,[\s\S]*?p_active,[\s\S]*?p_reason\s*\)/i);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION app_private.update_staff_module(${signature}) TO authenticated, service_role`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.update_staff_module(${signature}) FROM PUBLIC, anon, service_role`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.update_staff_module(${signature}) TO authenticated, service_role`);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
