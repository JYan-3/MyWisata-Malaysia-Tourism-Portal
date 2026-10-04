import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("sponsored discovery placement creation RPC boundary migration", () => {
  it("preserves the preview-version guard, draft result, and authenticated-only grant", () => {
    const sql = migration("private_create_sponsored_discovery_placement");

    expect(sql).toMatch(/ALTER FUNCTION public\.create_sponsored_discovery_placement\(uuid, text, text, timestamp with time zone, timestamp with time zone, integer, text\) SET SCHEMA app_private/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.create_sponsored_discovery_placement\(\s*p_product_id uuid,\s*p_state text,\s*p_category_slug text,\s*p_starts_at timestamp with time zone,\s*p_ends_at timestamp with time zone,\s*p_priority integer,\s*p_preview_version text\s*\)[\s\S]*?RETURNS jsonb[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.create_sponsored_discovery_placement\(\s*p_product_id,\s*p_state,\s*p_category_slug,\s*p_starts_at,\s*p_ends_at,\s*p_priority,\s*p_preview_version\s*\)/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION app_private\.create_sponsored_discovery_placement\(uuid, text, text, timestamp with time zone, timestamp with time zone, integer, text\) TO authenticated/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.create_sponsored_discovery_placement\(uuid, text, text, timestamp with time zone, timestamp with time zone, integer, text\) FROM PUBLIC, anon, service_role/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.create_sponsored_discovery_placement\(uuid, text, text, timestamp with time zone, timestamp with time zone, integer, text\) TO authenticated/i);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
