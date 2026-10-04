import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("monthly payout report RPC boundary migration", () => {
  it("limits report generation to the service role and preserves report defaults", () => {
    const sql = migration("private_generate_monthly_payout_report");
    const signature = "date, text";

    expect(sql).toContain(`ALTER FUNCTION public.generate_monthly_payout_report(${signature}) SET SCHEMA app_private`);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.generate_monthly_payout_report\(\s*p_period_start date,\s*p_generated_by text DEFAULT 'scheduler'[\s\S]*?\)[\s\S]*?RETURNS jsonb[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.generate_monthly_payout_report\(\s*p_period_start,\s*p_generated_by\s*\)/i);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION app_private.generate_monthly_payout_report(${signature}) FROM PUBLIC, anon, authenticated, service_role`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION app_private.generate_monthly_payout_report(${signature}) TO service_role`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.generate_monthly_payout_report(${signature}) FROM PUBLIC, anon, authenticated, service_role`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.generate_monthly_payout_report(${signature}) TO service_role`);
    expect(sql).not.toContain(`GRANT EXECUTE ON FUNCTION public.generate_monthly_payout_report(${signature}) TO authenticated`);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
