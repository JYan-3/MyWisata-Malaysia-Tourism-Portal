import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("wallet withdrawal resume RPC boundary migration", () => {
  it("preserves optional IP/category defaults and approval guards behind an invoker wrapper", () => {
    const sql = migration("private_resume_wallet_withdrawal");
    const signature = "uuid, text, inet, text";

    expect(sql).toContain(`ALTER FUNCTION public.resume_wallet_withdrawal(${signature}) SET SCHEMA app_private`);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.resume_wallet_withdrawal\([\s\S]*?p_id uuid,[\s\S]*?p_reason text,[\s\S]*?p_ip inet DEFAULT NULL,[\s\S]*?p_reason_category text DEFAULT 'other'\s*\)[\s\S]*?RETURNS jsonb[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.resume_wallet_withdrawal\([\s\S]*?p_id,[\s\S]*?p_reason,[\s\S]*?p_ip,[\s\S]*?p_reason_category\s*\)/i);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION app_private.resume_wallet_withdrawal(${signature}) TO authenticated, service_role`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.resume_wallet_withdrawal(${signature}) FROM PUBLIC, anon, service_role`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.resume_wallet_withdrawal(${signature}) TO authenticated, service_role`);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
