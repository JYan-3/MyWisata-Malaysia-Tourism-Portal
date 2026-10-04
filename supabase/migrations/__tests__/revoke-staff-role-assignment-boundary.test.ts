import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("revoke staff role assignment RPC boundary migration", () => {
  it("keeps live role-revocation policy behind the authenticated and service role invoker wrapper", () => {
    const sql = migration("private_revoke_staff_role_assignment");
    const signature = "uuid, text";

    expect(sql).toContain(`ALTER FUNCTION public.revoke_staff_role_assignment(${signature}) SET SCHEMA app_private`);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.revoke_staff_role_assignment\([\s\S]*?p_assignment_id uuid,[\s\S]*?p_reason text\s*\)[\s\S]*?RETURNS void[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.revoke_staff_role_assignment\([\s\S]*?p_assignment_id,[\s\S]*?p_reason\s*\)/i);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION app_private.revoke_staff_role_assignment(${signature}) TO authenticated, service_role`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.revoke_staff_role_assignment(${signature}) FROM PUBLIC, anon, service_role`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.revoke_staff_role_assignment(${signature}) TO authenticated, service_role`);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
