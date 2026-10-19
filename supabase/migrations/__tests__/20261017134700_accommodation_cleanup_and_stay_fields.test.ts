import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261017134700_accommodation_cleanup_and_stay_fields.sql"),
  "utf8",
).replace(/--.*$/gm, "");

const uuids = (block: string) => block.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? [];

describe("accommodation cleanup and stay fields migration", () => {
  it("adds nullable hotel stay columns idempotently", () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS check_in_time time/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS check_out_time time/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS stay_policies text/i);
    expect(sql).not.toMatch(/(time|text)\s+NOT NULL/i);
  });

  it("recategorises exactly 12 food and 3 tour products, hides exactly 10", () => {
    const food = sql.match(/SET category_id = '11111111-0000-0000-0000-000000000001'[\s\S]*?\);/i)![0];
    const tours = sql.match(/SET category_id = '22222222-0000-0000-0000-000000000001'[\s\S]*?\);/i)![0];
    const hidden = sql.match(/SET status = 'inactive'[\s\S]*?\);/i)![0];
    // each block repeats the target category uuid once
    expect(uuids(food)).toHaveLength(1 + 12 + 1);
    expect(uuids(tours)).toHaveLength(1 + 3 + 1);
    expect(uuids(hidden)).toHaveLength(1 + 10);
  });

  it("changes only products, outlets and outlet_pages", () => {
    const touched = [...sql.matchAll(/(?:UPDATE|INSERT INTO)\s+public\.(\w+)/gi)].map((m) => m[1]);
    expect(new Set(touched)).toEqual(new Set(["products", "outlets", "outlet_pages"]));
    expect(sql).not.toMatch(/orders|order_items|wallet|payment|refund|booking_slots/i);
  });
});
