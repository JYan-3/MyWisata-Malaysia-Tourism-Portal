import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("legacy KYC review RPC boundary migration", () => {
  it("preserves administrator identity, action, and pending-state checks behind an invoker wrapper", () => {
    const sql = migration("private_review_kyc_legacy");
    const signature = "uuid, uuid, character varying, text";

    expect(sql).toContain(`ALTER FUNCTION public.review_kyc(${signature}) SET SCHEMA app_private`);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.review_kyc\([\s\S]*?p_submission_id uuid,[\s\S]*?p_admin_id uuid,[\s\S]*?p_action character varying,[\s\S]*?p_reason text DEFAULT NULL\s*\)[\s\S]*?RETURNS jsonb[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.review_kyc\([\s\S]*?p_submission_id,[\s\S]*?p_admin_id,[\s\S]*?p_action,[\s\S]*?p_reason\s*\)/i);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION app_private.review_kyc(${signature}) TO authenticated, service_role`);
    expect(sql).toContain(`REVOKE ALL ON FUNCTION public.review_kyc(${signature}) FROM PUBLIC, anon, service_role`);
    expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.review_kyc(${signature}) TO authenticated, service_role`);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
