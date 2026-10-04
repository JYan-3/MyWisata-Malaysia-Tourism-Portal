import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("admin user list RPC boundary migration", () => {
  it("preserves filter and paging defaults behind the super-admin implementation", () => {
    const sql = migration("private_admin_list_users");

    expect(sql).toMatch(/ALTER FUNCTION public\.admin_list_users\(text, text, text, text, boolean, integer, integer\) SET SCHEMA app_private/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.admin_list_users\([\s\S]*?p_search text DEFAULT NULL::text,[\s\S]*?p_page integer DEFAULT 1,[\s\S]*?p_page_size integer DEFAULT 15[\s\S]*?\)[\s\S]*?RETURNS jsonb[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.admin_list_users\(p_search, p_role, p_status, p_kyc_status, p_bio_locked, p_page, p_page_size\)/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION app_private\.admin_list_users\(text, text, text, text, boolean, integer, integer\) TO authenticated, service_role/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.admin_list_users\(text, text, text, text, boolean, integer, integer\) FROM PUBLIC, anon/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.admin_list_users\(text, text, text, text, boolean, integer, integer\) TO authenticated, service_role/i);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
