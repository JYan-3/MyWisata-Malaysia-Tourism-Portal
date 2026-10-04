import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("checkout session expiration RPC boundary migration", () => {
  it("keeps session expiration available only to trusted server callers", () => {
    const sql = migration("private_expire_checkout_sessions");
    const signature = "";

    expect(sql).toContain("ALTER FUNCTION public.expire_checkout_sessions() SET SCHEMA app_private");
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.expire_checkout_sessions\(\)[\s\S]*?RETURNS integer[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.expire_checkout_sessions\(\s*\)/i);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION app_private.expire_checkout_sessions(${signature}) FROM PUBLIC, anon, authenticated, service_role`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION app_private.expire_checkout_sessions(${signature}) TO service_role`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.expire_checkout_sessions(${signature}) FROM PUBLIC, anon, authenticated, service_role`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.expire_checkout_sessions(${signature}) TO service_role`);
    expect(sql).not.toContain(`GRANT EXECUTE ON FUNCTION public.expire_checkout_sessions(${signature}) TO authenticated`);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
