import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("customer withdrawal request RPC boundary migration", () => {
  it("preserves subject-user and balance guards behind an invoker wrapper", () => {
    const sql = migration("private_request_withdrawal");
    const signature = "uuid, numeric, text";

    expect(sql).toContain(`ALTER FUNCTION public.request_withdrawal(${signature}) SET SCHEMA app_private`);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.request_withdrawal\([\s\S]*?p_user_id uuid,[\s\S]*?p_amount_rm numeric,[\s\S]*?p_destination_label text\s*\)[\s\S]*?RETURNS jsonb[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.request_withdrawal\([\s\S]*?p_user_id,[\s\S]*?p_amount_rm,[\s\S]*?p_destination_label\s*\)/i);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION app_private.request_withdrawal(${signature}) TO authenticated, service_role`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.request_withdrawal(${signature}) FROM PUBLIC, anon, service_role`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.request_withdrawal(${signature}) TO authenticated, service_role`);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
