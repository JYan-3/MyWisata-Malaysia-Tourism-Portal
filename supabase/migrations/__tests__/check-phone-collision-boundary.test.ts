import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("phone collision RPC boundary migration", () => {
  it("keeps the stable boolean contract and binds signed-in checks to the caller", () => {
    const sql = migration("private_check_phone_collision");

    expect(sql).toMatch(/ALTER FUNCTION public\.check_phone_collision\(text, uuid\) SET SCHEMA app_private/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.check_phone_collision\(\s*p_phone text,\s*p_user_id uuid\s*\)[\s\S]*?RETURNS boolean[\s\S]*?LANGUAGE plpgsql[\s\S]*?STABLE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/IF current_user = 'authenticated'[\s\S]*?auth\.uid\(\) IS NULL[\s\S]*?p_user_id IS DISTINCT FROM auth\.uid\(\)[\s\S]*?RAISE EXCEPTION 'unauthorized'/i);
    expect(sql).toMatch(/RETURN app_private\.check_phone_collision\(\s*p_phone,\s*p_user_id\s*\)/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION app_private\.check_phone_collision\(text, uuid\) TO authenticated, service_role/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.check_phone_collision\(text, uuid\) FROM PUBLIC, anon, service_role/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.check_phone_collision\(text, uuid\) TO authenticated, service_role/i);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
