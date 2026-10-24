import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEMO_OUTLET_BADGE_SLUGS,
  DEMO_PRODUCT_TYPE_SLUGS_BY_CATEGORY,
} from "../../../scripts/lib/demo-taxonomy-fixtures.mjs";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20261023174745_demo_taxonomy_backfill.sql",
);

describe("existing catalogue demo taxonomy backfill", () => {
  it("updates only empty outlet badges and empty non-accommodation product types", () => {
    const sql = readFileSync(migrationPath, "utf8");

    expect(sql).toMatch(/UPDATE\s+public\.outlets[\s\S]*?SET\s+badge_slugs/i);
    expect(sql).toMatch(/UPDATE\s+public\.products[\s\S]*?SET\s+type_slugs/i);
    expect(sql).toMatch(/category\.slug\s+IN\s*\(\s*'food'\s*,\s*'activity'\s*,\s*'retail'\s*\)/i);
    for (const expression of ["outlet.badge_slugs", "product.type_slugs"]) {
      expect(sql).toMatch(
        new RegExp(`coalesce\\s*\\(\\s*cardinality\\(\\s*${expression.replace(".", "\\.")}\\s*\\)\\s*,\\s*0\\s*\\)\\s*=\\s*0`, "i"),
      );
    }
    expect(sql).not.toMatch(/UPDATE\s+public\.(?:users|vendors|orders|bookings|products\s+SET\s+(?!type_slugs))/i);
  });

  it("uses every approved badge and category-specific product type deterministically", () => {
    const sql = readFileSync(migrationPath, "utf8");
    const approvedSlugs = [
      ...DEMO_OUTLET_BADGE_SLUGS,
      ...Object.values(DEMO_PRODUCT_TYPE_SLUGS_BY_CATEGORY).flat(),
    ];

    for (const slug of approvedSlugs) {
      expect(sql).toContain(`'${slug}'`);
    }
    expect(sql).toMatch(/row_number\(\)\s+OVER\s*\(\s*ORDER BY[\s\S]*?slug[\s\S]*?id/i);
    expect(sql).not.toMatch(/\b(?:random|gen_random_uuid)\s*\(/i);
  });
});
