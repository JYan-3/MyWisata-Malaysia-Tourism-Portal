import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");
const writePolicies = [
  ["alerts", "Shared app can update alerts"],
  ["alerts", "Shared app can write alerts"],
  ["readings", "Shared app can write readings"],
  ["reports", "Shared app can write reports"],
] as const;

function migration(slug: string): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith(`_${slug}.sql`));
  expect(matches, `expected one migration for ${slug}`).toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("unscoped legacy telemetry write policy removal", () => {
  it("removes the four universal client write policies and preserves reads", () => {
    const sql = migration("remove_unscoped_legacy_table_writes");

    for (const [table, policy] of writePolicies) {
      expect(sql).toContain(`DROP POLICY IF EXISTS "${policy}" ON public.${table}`);
    }

    expect(sql).not.toMatch(/DROP POLICY IF EXISTS "Shared app can read/);
    expect(sql).not.toMatch(/\b(TRUNCATE|DELETE FROM|UPDATE public\.(alerts|readings|reports)|INSERT INTO public\.(alerts|readings|reports))\b/i);
  });
});
