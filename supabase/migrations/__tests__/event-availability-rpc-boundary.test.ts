import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("event availability RPC boundary migration", () => {
  it("preserves anonymous availability access behind an invoker wrapper", () => {
    const sql = migration("private_event_availability_rpc");

    expect(sql).toMatch(/ALTER FUNCTION public\.get_event_pickup_availability\(uuid, date\) SET SCHEMA app_private/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.get_event_pickup_availability\(\s*p_registration_id uuid,\s*p_pickup_date date\s*\)[\s\S]*?RETURNS jsonb[\s\S]*?STABLE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toContain("SELECT app_private.get_event_pickup_availability(p_registration_id, p_pickup_date)");
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION app_private\.get_event_pickup_availability\(uuid, date\) TO anon, authenticated, service_role/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.get_event_pickup_availability\(uuid, date\) FROM PUBLIC/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_event_pickup_availability\(uuid, date\) TO anon, authenticated, service_role/i);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
