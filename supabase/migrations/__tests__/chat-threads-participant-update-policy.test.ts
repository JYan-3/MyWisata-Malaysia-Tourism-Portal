import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("chat thread participant update policy hardening", () => {
  it("requires the resulting thread to remain accessible to the same participant or admin", () => {
    const sql = migration("harden_chat_threads_participant_update");
    const alterStart = sql.indexOf("ALTER POLICY chat_threads_participant_update");
    expect(alterStart).toBeGreaterThanOrEqual(0);

    const checkStart = sql.indexOf("WITH CHECK", alterStart);
    const checkEnd = sql.indexOf(";", checkStart);
    expect(checkStart).toBeGreaterThan(alterStart);
    expect(checkEnd).toBeGreaterThan(checkStart);

    const check = sql.slice(checkStart, checkEnd);
    expect(check).toContain("customer_id");
    expect(check).toContain("auth.uid()");
    expect(check).toContain("o.id = chat_threads.outlet_id");
    expect(check).toContain("v.owner_id = (SELECT auth.uid())");
    expect(check).toContain("om.outlet_id = chat_threads.outlet_id");
    expect(check).toContain("om.user_id = (SELECT auth.uid())");
    expect(check).toContain("app_private.is_admin((SELECT auth.uid()))");
    expect(check).not.toMatch(/WITH CHECK\s*\(\s*true\s*\)/i);
  });
});
