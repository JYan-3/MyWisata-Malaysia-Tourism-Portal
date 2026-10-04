import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("rollback entitlement policy RPC boundary migration", () => {
  it("preserves the UUID-returning rollback API behind an authenticated-only invoker wrapper", () => {
    const sql = migration("private_rollback_entitlement_policy");
    const signature = "uuid, integer, text";

    expect(sql).toContain(`ALTER FUNCTION public.rollback_entitlement_policy(${signature}) SET SCHEMA app_private`);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.rollback_entitlement_policy\([\s\S]*?p_policy_id uuid,[\s\S]*?p_target_version integer,[\s\S]*?p_reason text\s*\)[\s\S]*?RETURNS uuid[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.rollback_entitlement_policy\([\s\S]*?p_policy_id,[\s\S]*?p_target_version,[\s\S]*?p_reason\s*\)/i);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION app_private.rollback_entitlement_policy(${signature}) TO authenticated`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.rollback_entitlement_policy(${signature}) FROM PUBLIC, anon, service_role`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.rollback_entitlement_policy(${signature}) TO authenticated`);
    expect(sql).not.toContain(`GRANT EXECUTE ON FUNCTION public.rollback_entitlement_policy(${signature}) TO authenticated, service_role`);
    expect(sql).not.toContain(`GRANT EXECUTE ON FUNCTION app_private.rollback_entitlement_policy(${signature}) TO authenticated, service_role`);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
