import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("identity and approver RPC boundary migration", () => {
  it("preserves own-user checks, service access, and withdrawal policy dependencies", () => {
    const sql = migration("private_identity_approver_rpcs");

    expect(sql).toMatch(/ALTER FUNCTION public\.is_active_global_staff_super_admin\(uuid\) SET SCHEMA app_private/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.is_active_global_staff_super_admin\(p_user_id uuid\)[\s\S]*?RETURNS boolean[\s\S]*?STABLE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toContain("WHEN COALESCE(auth.role(), '') = 'service_role' THEN app_private.is_active_global_staff_super_admin(p_user_id)");
    expect(sql).toContain("WHEN auth.role() = 'authenticated' AND p_user_id IS NOT DISTINCT FROM auth.uid() THEN app_private.is_active_global_staff_super_admin(p_user_id)");

    expect(sql).toMatch(/ALTER FUNCTION public\.is_approver\(uuid\) SET SCHEMA app_private/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.is_approver\(uid uuid\)[\s\S]*?RETURNS boolean[\s\S]*?STABLE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toContain("WHEN COALESCE(auth.role(), '') = 'service_role' THEN app_private.is_approver(uid)");
    expect(sql).toContain("WHEN auth.role() = 'authenticated' AND uid IS NOT DISTINCT FROM auth.uid() THEN app_private.is_approver(uid)");

    expect(sql).toMatch(/ALTER FUNCTION public\.resolve_user_capability\(uuid, text\) SET SCHEMA app_private/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.resolve_user_capability\(p_user_id uuid, p_capability_key text\)[\s\S]*?RETURNS jsonb[\s\S]*?STABLE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toContain("RAISE EXCEPTION 'authentication_required'");
    expect(sql).toContain("RAISE EXCEPTION 'resolver_subject_forbidden'");
    expect(sql).toContain("RETURN app_private.resolve_user_capability(p_user_id, p_capability_key)");

    for (const [name, signature] of [
      ["is_active_global_staff_super_admin", "uuid"],
      ["is_approver", "uuid"],
      ["resolve_user_capability", "uuid, text"],
    ]) {
      expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION app_private\\.${name}\\(${signature.replace(", ", ", ")}\\) TO authenticated, service_role`, "i"));
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\(${signature.replace(", ", ", ")}\\) FROM PUBLIC, anon`, "i"));
      expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\(${signature.replace(", ", ", ")}\\) TO authenticated, service_role`, "i"));
    }
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
