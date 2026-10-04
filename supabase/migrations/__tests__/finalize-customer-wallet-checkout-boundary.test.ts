import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("customer wallet checkout finalization RPC boundary migration", () => {
  it("preserves the authenticated ownership and payment confirmation API", () => {
    const sql = migration("private_finalize_customer_wallet_checkout");
    const signature = "uuid, text";

    expect(sql).toContain(`ALTER FUNCTION public.finalize_customer_wallet_checkout(${signature}) SET SCHEMA app_private`);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.finalize_customer_wallet_checkout\([\s\S]*?p_checkout_session_id uuid,[\s\S]*?p_outcome text\s*\)[\s\S]*?RETURNS jsonb[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.finalize_customer_wallet_checkout\([\s\S]*?p_checkout_session_id,[\s\S]*?p_outcome\s*\)/i);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION app_private.finalize_customer_wallet_checkout(${signature}) TO authenticated, service_role`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.finalize_customer_wallet_checkout(${signature}) FROM PUBLIC, anon, service_role`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.finalize_customer_wallet_checkout(${signature}) TO authenticated, service_role`);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
