import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("withdrawal rejection RPC boundary migration", () => {
  it("preserves the nullable note, void result, and authenticated/service access", () => {
    const sql = migration("private_admin_reject_withdrawal");

    expect(sql).toMatch(/ALTER FUNCTION public\.admin_reject_withdrawal\(uuid, text\) SET SCHEMA app_private/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.admin_reject_withdrawal\(\s*p_withdrawal_id uuid,\s*p_note text DEFAULT NULL::text\s*\)[\s\S]*?RETURNS void[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.admin_reject_withdrawal\(p_withdrawal_id, p_note\)/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION app_private\.admin_reject_withdrawal\(uuid, text\) TO authenticated, service_role/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.admin_reject_withdrawal\(uuid, text\) FROM PUBLIC, anon, service_role/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.admin_reject_withdrawal\(uuid, text\) TO authenticated, service_role/i);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
