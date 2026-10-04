import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("sponsored event RPC boundary migration", () => {
  it("preserves event validation and anon/auth execution behind an invoker wrapper", () => {
    const sql = migration("private_sponsored_event_rpc");

    expect(sql).toMatch(/ALTER FUNCTION public\.record_sponsored_discovery_event\(uuid, uuid, text\) SET SCHEMA app_private/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.record_sponsored_discovery_event\(p_placement_id uuid, p_product_id uuid, p_event_type text\)[\s\S]*?RETURNS timestamp with time zone[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toContain("SELECT app_private.record_sponsored_discovery_event(p_placement_id, p_product_id, p_event_type)");
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION app_private\.record_sponsored_discovery_event\(uuid, uuid, text\) FROM PUBLIC, service_role/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION app_private\.record_sponsored_discovery_event\(uuid, uuid, text\) TO anon, authenticated/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.record_sponsored_discovery_event\(uuid, uuid, text\) FROM PUBLIC/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.record_sponsored_discovery_event\(uuid, uuid, text\) TO anon, authenticated/i);
    expect(sql).not.toMatch(/record_sponsored_discovery_event\(uuid, uuid, text\) TO[^;]*service_role/i);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
