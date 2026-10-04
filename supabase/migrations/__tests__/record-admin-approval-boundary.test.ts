import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("admin withdrawal approval RPC boundary migration", () => {
  it("preserves admin, self-dealing, and dual-approval checks behind an invoker wrapper", () => {
    const sql = migration("private_record_admin_approval");

    expect(sql).toContain("ALTER FUNCTION public.record_admin_approval(uuid) SET SCHEMA app_private");
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.record_admin_approval\(\s*p_withdrawal_id uuid\s*\)[\s\S]*?RETURNS jsonb[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toContain("SELECT app_private.record_admin_approval(p_withdrawal_id)");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION app_private.record_admin_approval(uuid) TO authenticated, service_role");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.record_admin_approval(uuid) FROM PUBLIC, anon, service_role");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.record_admin_approval(uuid) TO authenticated, service_role");
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
