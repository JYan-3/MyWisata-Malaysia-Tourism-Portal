import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("recommendation vendor claim RPC boundary migration", () => {
  it("preserves the one-time onboarding transaction and 11-argument JSONB API", () => {
    const sql = migration("private_claim_vendor_recommendation");

    expect(sql).toMatch(/ALTER FUNCTION public\.claim_vendor_recommendation\(text, text, text, text, uuid, text, text, text, text, double precision, double precision\) SET SCHEMA app_private/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.claim_vendor_recommendation\([\s\S]*?p_category_id uuid,[\s\S]*?p_latitude double precision,[\s\S]*?p_longitude double precision[\s\S]*?\)[\s\S]*?RETURNS jsonb[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.claim_vendor_recommendation\([\s\S]*?p_token_hash,[\s\S]*?p_business_name,[\s\S]*?p_legal_business_name,[\s\S]*?p_description,[\s\S]*?p_category_id,[\s\S]*?p_outlet_name,[\s\S]*?p_contact_email,[\s\S]*?p_contact_phone,[\s\S]*?p_business_address,[\s\S]*?p_latitude,[\s\S]*?p_longitude[\s\S]*?\)/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION app_private\.claim_vendor_recommendation\(text, text, text, text, uuid, text, text, text, text, double precision, double precision\) TO authenticated, service_role/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.claim_vendor_recommendation\(text, text, text, text, uuid, text, text, text, text, double precision, double precision\) FROM PUBLIC, anon, service_role/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.claim_vendor_recommendation\(text, text, text, text, uuid, text, text, text, text, double precision, double precision\) TO authenticated, service_role/i);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
