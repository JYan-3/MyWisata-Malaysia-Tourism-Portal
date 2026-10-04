import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("withdrawal read RPC boundary migration", () => {
  it("preserves guarded payout projections, argument defaults, and role access", () => {
    const sql = migration("private_withdrawal_read_rpcs");

    expect(sql).toMatch(/ALTER FUNCTION public\.get_withdrawal_review_sources\(uuid, integer, integer\) SET SCHEMA app_private/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.get_withdrawal_review_sources\(p_withdrawal_id uuid, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0\)[\s\S]*?RETURNS jsonb[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toContain("SELECT app_private.get_withdrawal_review_sources(p_withdrawal_id, p_limit, p_offset)");

    expect(sql).toMatch(/ALTER FUNCTION public\.get_withdrawal_settlement_proof\(uuid\) SET SCHEMA app_private/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.get_withdrawal_settlement_proof\(p_withdrawal_id uuid\)[\s\S]*?RETURNS jsonb[\s\S]*?STABLE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toContain("SELECT app_private.get_withdrawal_settlement_proof(p_withdrawal_id)");

    for (const [name, signature] of [
      ["get_withdrawal_review_sources", "uuid, integer, integer"],
      ["get_withdrawal_settlement_proof", "uuid"],
    ]) {
      expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION app_private\\.${name}\\(${signature}\\) TO authenticated, service_role`, "i"));
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\(${signature}\\) FROM PUBLIC, anon`, "i"));
      expect(sql).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\(${signature}\\) TO authenticated, service_role`, "i"));
    }
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
