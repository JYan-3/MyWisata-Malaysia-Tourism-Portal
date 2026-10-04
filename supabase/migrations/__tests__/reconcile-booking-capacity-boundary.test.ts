import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("booking capacity reconciliation RPC boundary migration", () => {
  it("preserves the admin-only reconciliation behind an invoker wrapper", () => {
    const sql = migration("private_reconcile_booking_capacity");

    expect(sql).toContain("ALTER FUNCTION public.reconcile_booking_capacity() SET SCHEMA app_private");
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.reconcile_booking_capacity\(\)[\s\S]*?RETURNS integer[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toContain("SELECT app_private.reconcile_booking_capacity()");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION app_private.reconcile_booking_capacity() TO authenticated, service_role");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.reconcile_booking_capacity() FROM PUBLIC, anon, service_role");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.reconcile_booking_capacity() TO authenticated, service_role");
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
