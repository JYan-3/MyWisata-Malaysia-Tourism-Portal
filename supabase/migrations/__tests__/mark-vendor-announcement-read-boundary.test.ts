import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("vendor announcement read RPC boundary migration", () => {
  it("preserves authenticated per-user read tracking behind an invoker wrapper", () => {
    const sql = migration("private_mark_vendor_announcement_read");

    expect(sql).toMatch(/ALTER FUNCTION public\.mark_vendor_announcement_read\(uuid\) SET SCHEMA app_private/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.mark_vendor_announcement_read\(p_announcement_id uuid\)[\s\S]*?RETURNS void[\s\S]*?LANGUAGE sql[\s\S]*?VOLATILE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toMatch(/SELECT app_private\.mark_vendor_announcement_read\(p_announcement_id\)/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION app_private\.mark_vendor_announcement_read\(uuid\) TO authenticated, service_role/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.mark_vendor_announcement_read\(uuid\) FROM PUBLIC, anon/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.mark_vendor_announcement_read\(uuid\) TO authenticated, service_role/i);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
