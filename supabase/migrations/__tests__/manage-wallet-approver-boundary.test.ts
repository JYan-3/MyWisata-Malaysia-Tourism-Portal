import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("wallet approver management RPC boundary migration", () => {
  it("preserves super-admin, self-change, and final-approver guards", () => {
    const sql = migration("private_manage_wallet_approver");
    const signature = "uuid, text, text, text";

    expect(sql).toContain(`ALTER FUNCTION public.manage_wallet_approver(${signature}) SET SCHEMA app_private`);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.manage_wallet_approver\([\s\S]*?p_target_user_id uuid,[\s\S]*?p_action text,[\s\S]*?p_reason_category text,[\s\S]*?p_note text\s*\)[\s\S]*?RETURNS jsonb[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.manage_wallet_approver\([\s\S]*?p_target_user_id,[\s\S]*?p_action,[\s\S]*?p_reason_category,[\s\S]*?p_note\s*\)/i);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION app_private.manage_wallet_approver(${signature}) TO authenticated, service_role`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.manage_wallet_approver(${signature}) FROM PUBLIC, anon, service_role`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.manage_wallet_approver(${signature}) TO authenticated, service_role`);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
