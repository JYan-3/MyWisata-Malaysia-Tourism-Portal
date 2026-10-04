import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("event vendor invitation claim RPC boundary migration", () => {
  it("preserves the one-time invite transaction and JSONB API behind an invoker wrapper", () => {
    const sql = migration("private_claim_event_vendor_invite");

    expect(sql).toMatch(/ALTER FUNCTION public\.claim_event_vendor_invite\(text, text, text, text, text, text, text\) SET SCHEMA app_private/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.claim_event_vendor_invite\([\s\S]*?RETURNS jsonb[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.claim_event_vendor_invite\([\s\S]*?p_token_hash,[\s\S]*?p_business_name,[\s\S]*?p_legal_business_name,[\s\S]*?p_description,[\s\S]*?p_contact_email,[\s\S]*?p_contact_phone,[\s\S]*?p_business_address[\s\S]*?\)/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION app_private\.claim_event_vendor_invite\(text, text, text, text, text, text, text\) TO authenticated, service_role/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.claim_event_vendor_invite\(text, text, text, text, text, text, text\) FROM PUBLIC, anon, service_role/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.claim_event_vendor_invite\(text, text, text, text, text, text, text\) TO authenticated, service_role/i);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
