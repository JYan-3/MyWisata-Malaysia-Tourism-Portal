import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("affiliate code generation RPC boundary migration", () => {
  it("preserves the self/admin guarded text result behind an invoker wrapper", () => {
    const sql = migration("private_gen_affiliate_code");

    expect(sql).toMatch(/ALTER FUNCTION public\.gen_affiliate_code\(uuid\) SET SCHEMA app_private/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.gen_affiliate_code\(p_user_id uuid\)[\s\S]*?RETURNS text[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER[\s\S]*?SET search_path TO 'extensions', 'public', 'pg_temp'/i);
    expect(sql).toMatch(/SELECT app_private\.gen_affiliate_code\(p_user_id\)/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION app_private\.gen_affiliate_code\(uuid\) TO authenticated, service_role/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.gen_affiliate_code\(uuid\) FROM PUBLIC, anon/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.gen_affiliate_code\(uuid\) TO authenticated, service_role/i);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
