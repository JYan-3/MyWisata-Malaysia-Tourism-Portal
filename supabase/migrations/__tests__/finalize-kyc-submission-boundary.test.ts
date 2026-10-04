import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("KYC submission finalization RPC boundary migration", () => {
  it("preserves authenticated owner-bound document finalization", () => {
    const sql = migration("private_finalize_kyc_submission");
    const signature = "uuid, text, text";

    expect(sql).toContain(`ALTER FUNCTION public.finalize_kyc_submission(${signature}) SET SCHEMA app_private`);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.finalize_kyc_submission\([\s\S]*?p_submission_id uuid,[\s\S]*?p_front_path text,[\s\S]*?p_back_path text\s*\)[\s\S]*?RETURNS uuid[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.finalize_kyc_submission\([\s\S]*?p_submission_id,[\s\S]*?p_front_path,[\s\S]*?p_back_path\s*\)/i);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION app_private.finalize_kyc_submission(${signature}) TO authenticated, service_role`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.finalize_kyc_submission(${signature}) FROM PUBLIC, anon, service_role`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.finalize_kyc_submission(${signature}) TO authenticated, service_role`);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
