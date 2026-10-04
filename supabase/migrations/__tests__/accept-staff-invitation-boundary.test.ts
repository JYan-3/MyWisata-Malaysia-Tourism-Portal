import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("staff invitation acceptance RPC boundary migration", () => {
  it("preserves the token acceptance contract and identity checks behind an invoker wrapper", () => {
    const sql = migration("private_accept_staff_invitation");

    expect(sql).toMatch(/ALTER FUNCTION public\.accept_staff_invitation\(text\) SET SCHEMA app_private/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.accept_staff_invitation\(p_token_hash text\)[\s\S]*?RETURNS jsonb[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.accept_staff_invitation\(p_token_hash\)/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION app_private\.accept_staff_invitation\(text\) TO authenticated, service_role/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.accept_staff_invitation\(text\) FROM PUBLIC, anon/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.accept_staff_invitation\(text\) TO authenticated, service_role/i);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
