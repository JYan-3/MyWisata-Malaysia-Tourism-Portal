import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("staff invitation delivery finalization RPC boundary migration", () => {
  it("preserves super-admin validation and token-bound delivery finalization", () => {
    const sql = migration("private_finalize_staff_invitation_delivery");
    const signature = "uuid, text, boolean";

    expect(sql).toContain(`ALTER FUNCTION public.finalize_staff_invitation_delivery(${signature}) SET SCHEMA app_private`);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.finalize_staff_invitation_delivery\([\s\S]*?p_invitation_id uuid,[\s\S]*?p_token_hash text,[\s\S]*?p_succeeded boolean\s*\)[\s\S]*?RETURNS void[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.finalize_staff_invitation_delivery\([\s\S]*?p_invitation_id,[\s\S]*?p_token_hash,[\s\S]*?p_succeeded\s*\)/i);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION app_private.finalize_staff_invitation_delivery(${signature}) TO authenticated, service_role`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.finalize_staff_invitation_delivery(${signature}) FROM PUBLIC, anon, service_role`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.finalize_staff_invitation_delivery(${signature}) TO authenticated, service_role`);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
