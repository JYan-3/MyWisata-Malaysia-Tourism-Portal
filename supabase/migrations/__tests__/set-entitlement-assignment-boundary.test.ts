import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("set entitlement assignment RPC boundary migration", () => {
  it("preserves the UUID assignment API behind an authenticated-only invoker wrapper", () => {
    const sql = migration("private_set_entitlement_assignment");
    const signature = "text, text, text, text, timestamp with time zone, timestamp with time zone, text";

    expect(sql).toContain(`ALTER FUNCTION public.set_entitlement_assignment(${signature}) SET SCHEMA app_private`);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.set_entitlement_assignment\([\s\S]*?p_subject_type text,[\s\S]*?p_subject_id text,[\s\S]*?p_capability_key text,[\s\S]*?p_effect text,[\s\S]*?p_starts_at timestamp with time zone,[\s\S]*?p_expires_at timestamp with time zone,[\s\S]*?p_reason text\s*\)[\s\S]*?RETURNS uuid[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.set_entitlement_assignment\([\s\S]*?p_subject_type,[\s\S]*?p_subject_id,[\s\S]*?p_capability_key,[\s\S]*?p_effect,[\s\S]*?p_starts_at,[\s\S]*?p_expires_at,[\s\S]*?p_reason\s*\)/i);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION app_private.set_entitlement_assignment(${signature}) TO authenticated`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.set_entitlement_assignment(${signature}) FROM PUBLIC, anon, service_role`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.set_entitlement_assignment(${signature}) TO authenticated`);
    expect(sql).not.toContain(`GRANT EXECUTE ON FUNCTION public.set_entitlement_assignment(${signature}) TO authenticated, service_role`);
    expect(sql).not.toContain(`GRANT EXECUTE ON FUNCTION app_private.set_entitlement_assignment(${signature}) TO authenticated, service_role`);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
