import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("withdrawal escalation RPC boundary migration", () => {
  it("keeps the maintenance RPC available only to service role", () => {
    const sql = migration("private_escalate_withdrawals");
    const signature = "timestamp with time zone";

    expect(sql).toContain(`ALTER FUNCTION public.escalate_withdrawals(${signature}) SET SCHEMA app_private`);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.escalate_withdrawals\(\s*p_now timestamp with time zone DEFAULT now\(\)\s*\)[\s\S]*?RETURNS integer[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.escalate_withdrawals\(\s*p_now\s*\)/i);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION app_private.escalate_withdrawals(${signature}) FROM PUBLIC, anon, authenticated, service_role`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION app_private.escalate_withdrawals(${signature}) TO service_role`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.escalate_withdrawals(${signature}) FROM PUBLIC, anon, authenticated, service_role`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.escalate_withdrawals(${signature}) TO service_role`);
    expect(sql).not.toContain(`GRANT EXECUTE ON FUNCTION public.escalate_withdrawals(${signature}) TO authenticated`);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
