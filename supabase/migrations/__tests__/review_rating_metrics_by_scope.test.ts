import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

function migration(): string {
  const matches = readdirSync(migrationsDirectory).filter((file) => file.endsWith("_review_rating_metrics_by_scope.sql"));
  expect(matches, "expected one migration for review_rating_metrics_by_scope").toHaveLength(1);
  return readFileSync(resolve(migrationsDirectory, matches[0]), "utf8");
}

describe("review rating metrics by scope migration", () => {
  it("aggregates only visible reviews by vendor, outlet, product, product-outlet, and rating", () => {
    const sql = migration();

    expect(sql).toMatch(/CREATE(?: OR REPLACE)? VIEW public\.review_rating_metrics_by_scope[\s\S]*?security_invoker\s*=\s*true/i);
    expect(sql).toMatch(/'vendor'::text[\s\S]*?vendor_id[\s\S]*?is_visible\s*=\s*true[\s\S]*?GROUP BY[^;]*vendor_id[^;]*rating/i);
    expect(sql).toMatch(/'outlet'::text[\s\S]*?outlet_id[\s\S]*?is_visible\s*=\s*true[\s\S]*?GROUP BY[^;]*outlet_id[^;]*rating/i);
    expect(sql).toMatch(/'product'::text[\s\S]*?product_id[\s\S]*?is_visible\s*=\s*true[\s\S]*?GROUP BY[^;]*product_id[^;]*rating/i);
    expect(sql).toMatch(/'product_outlet'::text[\s\S]*?product_id[\s\S]*?outlet_id[\s\S]*?is_visible\s*=\s*true[\s\S]*?GROUP BY[^;]*product_id[^;]*outlet_id[^;]*rating/i);
    const hotelScope = sql.split("'outlet_accommodation'::text")[1]?.split("REVOKE ALL")[0] ?? "";
    expect(hotelScope).toContain("reviews.outlet_id AS scope_id");
    expect(hotelScope).toContain("JOIN public.products AS products ON products.id = reviews.product_id");
    expect(hotelScope).toContain("JOIN public.categories AS categories ON categories.id = products.category_id");
    expect(hotelScope).toContain("categories.slug = 'accommodation'");
    expect(hotelScope).toContain("reviews.is_visible = true");
    expect(hotelScope).toContain("GROUP BY reviews.outlet_id, reviews.rating");
    expect(sql).toContain("COUNT(*)::bigint AS review_count");
    expect(sql).not.toMatch(/SELECT\s+\*/i);
  });

  it("keeps the aggregate inaccessible to browser roles", () => {
    const sql = migration();

    expect(sql).toMatch(/REVOKE ALL(?: PRIVILEGES)? ON TABLE public\.review_rating_metrics_by_scope FROM PUBLIC,\s*anon,\s*authenticated/i);
    expect(sql).toMatch(/GRANT SELECT ON TABLE public\.review_rating_metrics_by_scope TO service_role/i);
    expect(sql).not.toMatch(/GRANT\s+SELECT[\s\S]*?review_rating_metrics_by_scope[\s\S]*?TO\s+(?:anon|authenticated)/i);
  });
});
