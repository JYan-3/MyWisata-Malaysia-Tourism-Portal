import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("withdrawal risk override RPC boundary migration", () => {
  it("preserves super-admin, high-risk, and self-dealing guards", () => {
    const sql = migration("private_override_withdrawal_risk");
    const signature = "uuid, text, inet";

    expect(sql).toContain(`ALTER FUNCTION public.override_withdrawal_risk(${signature}) SET SCHEMA app_private`);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.override_withdrawal_risk\([\s\S]*?p_withdrawal_id uuid,[\s\S]*?p_reason text,[\s\S]*?p_ip inet DEFAULT NULL[\s\S]*?\)[\s\S]*?RETURNS jsonb[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toContain("p_ip inet DEFAULT NULL::inet");
    expect(sql).toMatch(/SELECT app_private\.override_withdrawal_risk\([\s\S]*?p_withdrawal_id,[\s\S]*?p_reason,[\s\S]*?p_ip\s*\)/i);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION app_private.override_withdrawal_risk(${signature}) TO authenticated, service_role`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.override_withdrawal_risk(${signature}) FROM PUBLIC, anon, service_role`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.override_withdrawal_risk(${signature}) TO authenticated, service_role`);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
