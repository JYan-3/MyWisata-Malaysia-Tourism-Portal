import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(): string {
  const matches = readdirSync(migrationsDirectory).filter((file) =>
    file.endsWith("_vendor_managed_product_types_outlet_badges.sql"),
  );
  expect(matches, "expected one outlet taxonomy migration").toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("vendor-managed product types and outlet badges migration", () => {
  it("adds only non-null, empty-array outlet metadata fields", () => {
    const sql = migration();
    expect(sql).toMatch(/ALTER\s+TABLE\s+(?:public\.)?outlets/i);
    for (const column of ["badge_slugs", "accommodation_type_slugs"]) {
      expect(sql).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS ${column} text\\[\\] NOT NULL DEFAULT '\\{\\}'`, "i"));
    }
    expect(sql).not.toMatch(/ALTER\s+TABLE\s+(?:public\.)?products/i);
    expect(sql).not.toMatch(/DROP\s+COLUMN|UPDATE\s+(?:public\.)?products/i);
  });

  it("grants only the new metadata columns to public customer roles", () => {
    const sql = migration();
    expect(sql).toMatch(/GRANT\s+SELECT\s*\(\s*badge_slugs\s*,\s*accommodation_type_slugs\s*\)\s+ON\s+TABLE\s+(?:public\.)?outlets\s+TO\s+anon\s*,\s*authenticated/i);
    expect(sql).not.toMatch(/GRANT\s+SELECT\s+ON\s+TABLE\s+(?:public\.)?outlets\s+TO\s+anon/i);
  });
});
