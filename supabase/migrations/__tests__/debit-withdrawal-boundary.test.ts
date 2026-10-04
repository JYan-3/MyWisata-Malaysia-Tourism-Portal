import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("withdrawal debit RPC boundary migration", () => {
  it("preserves the authenticated withdrawal API and original grants", () => {
    const sql = migration("private_debit_withdrawal");
    const signature = "uuid, numeric";

    expect(sql).toContain(`ALTER FUNCTION public.debit_withdrawal(${signature}) SET SCHEMA app_private`);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.debit_withdrawal\(\s*p_user_id uuid,\s*p_amount_rm numeric\s*\)[\s\S]*?RETURNS jsonb[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.debit_withdrawal\(\s*p_user_id,\s*p_amount_rm\s*\)/i);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION app_private.debit_withdrawal(${signature}) TO authenticated, service_role`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.debit_withdrawal(${signature}) FROM PUBLIC, anon, service_role`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.debit_withdrawal(${signature}) TO authenticated, service_role`);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
