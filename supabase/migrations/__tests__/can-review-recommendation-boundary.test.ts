import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("can_review_recommendation RPC boundary migration", () => {
  it("keeps user-scoped checks and the original RLS function OID behind an invoker wrapper", () => {
    const sql = migration("private_can_review_recommendation");

    expect(sql).toMatch(/ALTER FUNCTION public\.can_review_recommendation\(uuid\) SET SCHEMA app_private/i);
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.can_review_recommendation\(uid uuid\)[\s\S]*?RETURNS boolean[\s\S]*?STABLE[\s\S]*?SECURITY INVOKER/i);
    expect(sql).toContain("WHEN auth.role() = 'service_role' THEN app_private.can_review_recommendation(uid)");
    expect(sql).toContain("WHEN auth.role() = 'authenticated' AND uid = auth.uid() THEN app_private.can_review_recommendation(uid)");
    expect(sql).toContain("ELSE false");
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION app_private\.can_review_recommendation\(uuid\) TO authenticated, service_role/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.can_review_recommendation\(uuid\) FROM PUBLIC, anon/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.can_review_recommendation\(uuid\) TO authenticated, service_role/i);
    expect(sql).toContain("NOTIFY pgrst, 'reload schema'");
  });
});
