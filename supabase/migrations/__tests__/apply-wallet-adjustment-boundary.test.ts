import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("wallet adjustment RPC boundary migration", () => {
  it("preserves the super-admin-only wallet transaction and existing role grants", () => {
    const sql = migration("private_apply_wallet_adjustment");

    expect(sql).toMatch(/ALTER FUNCTION public\.apply_wallet_adjustment\(uuid, text, text, bigint, text\) SET SCHEMA app_private/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.apply_wallet_adjustment\([\s\S]*?p_user_id uuid,[\s\S]*?p_bucket text,[\s\S]*?p_direction text,[\s\S]*?p_amount_sen bigint,[\s\S]*?p_reason text[\s\S]*?\)[\s\S]*?RETURNS jsonb[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.apply_wallet_adjustment\(\s*p_user_id,\s*p_bucket,\s*p_direction,\s*p_amount_sen,\s*p_reason\s*\)/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION app_private\.apply_wallet_adjustment\(uuid, text, text, bigint, text\) TO authenticated, service_role/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.apply_wallet_adjustment\(uuid, text, text, bigint, text\) FROM PUBLIC, anon, service_role/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.apply_wallet_adjustment\(uuid, text, text, bigint, text\) TO authenticated, service_role/i);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
