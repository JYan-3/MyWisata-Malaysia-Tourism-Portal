import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("staff invitation RPC boundary migration", () => {
  it("preserves invitation authorization and creation behind an invoker wrapper", () => {
    const sql = migration("private_prepare_staff_invitation");
    const signature = "text, uuid, text, text, timestamp with time zone";

    expect(sql).toContain(`ALTER FUNCTION public.prepare_staff_invitation(${signature}) SET SCHEMA app_private`);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.prepare_staff_invitation\([\s\S]*?p_invited_email text,[\s\S]*?p_staff_role_id uuid,[\s\S]*?p_reason text,[\s\S]*?p_token_hash text,[\s\S]*?p_expires_at timestamp with time zone\s*\)[\s\S]*?RETURNS jsonb[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.prepare_staff_invitation\([\s\S]*?p_invited_email,[\s\S]*?p_staff_role_id,[\s\S]*?p_reason,[\s\S]*?p_token_hash,[\s\S]*?p_expires_at\s*\)/i);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION app_private.prepare_staff_invitation(${signature}) TO authenticated, service_role`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.prepare_staff_invitation(${signature}) FROM PUBLIC, anon, service_role`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.prepare_staff_invitation(${signature}) TO authenticated, service_role`);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
