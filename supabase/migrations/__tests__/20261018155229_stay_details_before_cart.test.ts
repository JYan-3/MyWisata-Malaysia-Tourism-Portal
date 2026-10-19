import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261018155229_stay_details_before_cart.sql"), "utf8");
const orderSnapshotMigration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261018170000_stay_booking_details.sql"), "utf8");

describe("stay details before cart migration", () => {
  it("adds nullable object-shaped stay details to cart and order lines", () => {
    for (const table of ["cart_items", "order_items"]) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE public\\.${table}[\\s\\S]*?ADD COLUMN IF NOT EXISTS stay_details JSONB`));
      expect(sql).toMatch(new RegExp(`${table}_stay_details_object_check`));
    }
  });

  it("validates accommodation details from the owned cart row and copies them into its order item", () => {
    expect(sql).toContain("public.checkout_transaction_core(");
    expect(sql).toContain("stay_details");
    expect(sql).toContain("primaryGuestName");
    expect(sql).toMatch(/INSERT INTO public\.order_items[\s\S]*stay_details/i);
  });

  it("parenthesizes CASE conditions inside PL/pgSQL IF predicates", () => {
    const validation = sql.match(/v_validation_new TEXT := \$new\$([\s\S]*?)\$new\$;/)?.[1] ?? "";

    expect(validation.match(/\bOR CASE\b/g)).toBeNull();
    expect(validation.match(/\bOR \(CASE\b/g)).toHaveLength(3);
    expect(validation.match(/\bEND\)/g)).toHaveLength(3);
  });

  it("keeps the SQL transaction validation aligned with the application schema", () => {
    expect(sql).toContain("jsonb_object_keys(v_cart_item.stay_details)");
    expect(sql).toContain("specialRequest");
    expect(sql).toContain("> 500");
  });

  it("does not rewrite historical orders or drop existing data", () => {
    expect(sql).not.toMatch(/\b(?:DROP\s+(?:TABLE|COLUMN)|DELETE\s+FROM|UPDATE\s+public\.orders)\b/i);
  });

  it("keeps the earlier generated patch independent from the pending order-level migration", () => {
    expect(sql).not.toMatch(/INSERT INTO public\.orders/i);
    expect(orderSnapshotMigration).toContain("checkout_transaction_core order insert changed");
    expect(orderSnapshotMigration).toContain("EXECUTE replace(v_core, v_order_insert_old, v_order_insert_new)");
  });
});
