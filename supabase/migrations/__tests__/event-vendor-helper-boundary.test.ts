import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("event vendor authorization helper boundary migration", () => {
  it("keeps the policy helper private and exposes an invoker wrapper with the same RPC contract", () => {
    const sql = migration("private_can_manage_vendor_events");

    expect(sql).toMatch(/ALTER FUNCTION public\.can_manage_vendor_events\(uuid\) SET SCHEMA app_private/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.can_manage_vendor_events\(p_vendor_id uuid\)\s+RETURNS boolean[\s\S]*?STABLE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toContain("SELECT app_private.can_manage_vendor_events(p_vendor_id)");
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION app_private\.can_manage_vendor_events\(uuid\) FROM PUBLIC, anon/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION app_private\.can_manage_vendor_events\(uuid\) TO authenticated, service_role/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.can_manage_vendor_events\(uuid\) FROM PUBLIC, anon/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.can_manage_vendor_events\(uuid\) TO authenticated, service_role/i);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
