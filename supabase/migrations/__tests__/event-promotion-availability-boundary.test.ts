import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("event promotion availability RPC boundary migration", () => {
  it("preserves date validation, output columns, and authenticated/service execution", () => {
    const sql = migration("private_event_promotion_availability");

    expect(sql).toMatch(/ALTER FUNCTION public\.get_event_promotion_date_availability\(date, date\) SET SCHEMA app_private/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.get_event_promotion_date_availability\(p_from date, p_to date\)[\s\S]*?RETURNS TABLE\(day date, occupied_count integer, available boolean\)[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toContain("SELECT * FROM app_private.get_event_promotion_date_availability(p_from, p_to)");
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION app_private\.get_event_promotion_date_availability\(date, date\) TO authenticated, service_role/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.get_event_promotion_date_availability\(date, date\) FROM PUBLIC, anon/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_event_promotion_date_availability\(date, date\) TO authenticated, service_role/i);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
