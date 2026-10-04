import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("sponsored placement preview RPC boundary migration", () => {
  it("preserves the staff-guarded JSONB RPC through a volatile invoker wrapper", () => {
    const sql = migration("private_preview_sponsored_discovery_placement");

    expect(sql).toMatch(/ALTER FUNCTION public\.preview_sponsored_discovery_placement\(uuid, uuid, text, text, timestamp with time zone, timestamp with time zone, integer\) SET SCHEMA app_private/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.preview_sponsored_discovery_placement\([\s\S]*?RETURNS jsonb[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.preview_sponsored_discovery_placement\(\s*p_placement_id,\s*p_product_id,\s*p_state,\s*p_category_slug,\s*p_starts_at,\s*p_ends_at,\s*p_priority\s*\)/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION app_private\.preview_sponsored_discovery_placement\(uuid, uuid, text, text, timestamp with time zone, timestamp with time zone, integer\) TO authenticated/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.preview_sponsored_discovery_placement\(uuid, uuid, text, text, timestamp with time zone, timestamp with time zone, integer\) FROM PUBLIC, anon, service_role/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.preview_sponsored_discovery_placement\(uuid, uuid, text, text, timestamp with time zone, timestamp with time zone, integer\) TO authenticated/i);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
