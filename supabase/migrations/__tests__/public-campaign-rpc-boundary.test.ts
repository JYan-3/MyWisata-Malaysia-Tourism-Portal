import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("public campaign RPC boundary migration", () => {
  it("preserves the optional slug and public campaign projection through an invoker wrapper", () => {
    const sql = migration("private_public_campaign_rpc");

    expect(sql).toMatch(/ALTER FUNCTION public\.get_public_promotion_campaigns\(text\) SET SCHEMA app_private/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.get_public_promotion_campaigns\(p_slug text DEFAULT NULL\)[\s\S]*?RETURNS jsonb[\s\S]*?STABLE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toContain("SELECT app_private.get_public_promotion_campaigns(p_slug)");
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION app_private\.get_public_promotion_campaigns\(text\) TO anon, authenticated, service_role/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.get_public_promotion_campaigns\(text\) FROM PUBLIC/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_public_promotion_campaigns\(text\) TO anon, authenticated, service_role/i);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
