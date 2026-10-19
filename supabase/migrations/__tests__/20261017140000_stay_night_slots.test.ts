import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261017140000_stay_night_slots.sql"), "utf8").replace(
  /--.*$/gm,
  "",
);

describe("stay night slots migration", () => {
  it("adds nights to cart and order items with a 1-30 check", () => {
    for (const table of ["cart_items", "order_items"]) {
      expect(sql).toMatch(
        new RegExp(`ALTER TABLE public\\.${table}\\s+ADD COLUMN IF NOT EXISTS nights integer NOT NULL DEFAULT 1 CHECK \\(nights BETWEEN 1 AND 30\\)`),
      );
    }
  });

  it("preflights all five slot consumers before deleting future slots", () => {
    const preflight = sql.indexOf("stay_night_migration_aborted: % reference(s)");
    const del = sql.indexOf("DELETE FROM public.booking_slots WHERE id IN (SELECT id FROM _stay_future)");
    expect(preflight).toBeGreaterThan(-1);
    expect(del).toBeGreaterThan(preflight);
    for (const table of ["bookings", "cart_items", "checkout_reservations", "external_reservations", "order_items"]) {
      expect(sql).toContain(`FROM public.${table} WHERE slot_id IN (SELECT id FROM _stay_future)`);
      expect(sql).toMatch(new RegExp(`UPDATE public\\.${table} t SET slot_id = m\\.keeper_id`));
    }
  });

  it("repoints before deleting past duplicates and enforces night uniqueness afterwards", () => {
    const repoint = sql.indexOf("UPDATE public.order_items t SET slot_id");
    const dedupe = sql.indexOf("WHERE id <> keeper_id");
    const unique = sql.indexOf("UNIQUE (product_id, outlet_id, starts_at)");
    expect(repoint).toBeGreaterThan(-1);
    expect(dedupe).toBeGreaterThan(repoint);
    expect(unique).toBeGreaterThan(dedupe);
  });

  it("uses a seeded random, original quantity, and excludes cancelled/refunded", () => {
    expect(sql).toMatch(/setseed\(/);
    expect(sql).toContain("o.status NOT IN ('cancelled', 'refunded')");
    expect(sql).toContain("sum(o.quantity)");
    expect(sql).toContain("legacy_overbooked_count");
  });

  it("never writes money, wallet, payment or refund data", () => {
    const written = [...sql.matchAll(/(?:UPDATE|INSERT INTO|DELETE FROM)\s+public\.(\w+)/gi)].map((m) => m[1]);
    expect(new Set(written)).toEqual(
      new Set(["booking_slots", "bookings", "cart_items", "checkout_reservations", "external_reservations", "order_items"]),
    );
    expect(sql).not.toMatch(/line_total|unit_price|total_amount|wallet/i);
  });

  it("ensure_stay_nights is service-role only, locked, and idempotent", () => {
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("ON CONFLICT DO NOTHING");
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.ensure_stay_nights\(integer\) FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.ensure_stay_nights\(integer\) TO service_role/);
  });

  it("re-enables the slot outbox trigger it disabled", () => {
    expect(sql).toMatch(/DISABLE TRIGGER slot_outbox_enqueue/);
    expect(sql).toMatch(/ENABLE TRIGGER slot_outbox_enqueue/);
  });
});

describe("ensure-stay-nights cron", () => {
  it("is scheduled at 17:00 UTC (01:00 MYT)", () => {
    const vercel = JSON.parse(readFileSync(resolve(process.cwd(), "vercel.json"), "utf8"));
    expect(vercel.crons).toContainEqual({ path: "/api/cron/ensure-stay-nights", schedule: "0 17 * * *" });
  });
});
