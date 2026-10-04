import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("vendor registration RPC boundary migration", () => {
  it("preserves registration defaults and gallery validation behind an invoker wrapper", () => {
    const sql = migration("private_register_vendor_with_outlet");
    const signature = "text, text, text, text, text, text, text, text, text, text, text, text, jsonb";

    expect(sql).toContain(`ALTER FUNCTION public.register_vendor_with_outlet(${signature}) SET SCHEMA app_private`);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.register_vendor_with_outlet\([\s\S]*?p_name text,[\s\S]*?p_slug text DEFAULT NULL,[\s\S]*?p_business_address text DEFAULT NULL,[\s\S]*?p_logo_url text DEFAULT NULL,[\s\S]*?p_cover_url text DEFAULT NULL,[\s\S]*?p_gallery jsonb DEFAULT '\[\]'::jsonb\s*\)[\s\S]*?RETURNS jsonb[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.register_vendor_with_outlet\([\s\S]*?p_name,[\s\S]*?p_slug,[\s\S]*?p_gallery\s*\)/i);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION app_private.register_vendor_with_outlet(${signature}) TO authenticated, service_role`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.register_vendor_with_outlet(${signature}) FROM PUBLIC, anon, service_role`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.register_vendor_with_outlet(${signature}) TO authenticated, service_role`);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
