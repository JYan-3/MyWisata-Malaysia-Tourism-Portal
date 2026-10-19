import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261017143000_accommodation_checkout_nights.sql"), "utf8").replace(
  /--.*$/gm,
  "",
);

// Structural checks only: the 3-night booking, full-middle-night, expiry and concurrency scenarios need a real database.
describe("accommodation checkout nights migration", () => {
  it("carries nights through the line recordsets and validates 1-30", () => {
    expect(sql).toMatch(/nights\s+INTEGER/i);
    expect(sql).toContain("invalid_line_nights");
    expect(sql).toContain("checkout_line_mismatch");
  });

  it("locks every night in order and rejects unavailable nights", () => {
    expect(sql).toMatch(/FOR UPDATE/);
    expect(sql).toMatch(/ORDER BY (\w+\.)?starts_at/);
    expect(sql).toContain("stay_night_unavailable");
    expect(sql).toContain("invalid_checkout_totals");
  });

  it("holds one reservation per night", () => {
    expect(sql).toMatch(/INSERT INTO public\.checkout_reservations[\s\S]*?SELECT/);
  });

  it("reuses unpaid checkouts only when nights match", () => {
    expect(sql).toMatch(/coalesce\(\w*\.?nights,\s*1\)/i);
  });

  it("saves account contact on the order from both wrappers", () => {
    const calls = sql.match(/app_private\.apply_account_checkout_contact\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(3); // definition + two wrappers
    expect(sql).toContain("contact_email_required");
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION app_private\.apply_account_checkout_contact/);
  });

  it("blocks rescheduling stays", () => {
    expect(sql).toContain("stay_reschedule_unsupported");
  });

  it("leaves finalize_checkout and money tables alone", () => {
    expect(sql).not.toMatch(/FUNCTION\s+(public|app_private)\.finalize_checkout/i);
    expect(sql).not.toMatch(/(UPDATE|INSERT INTO|DELETE FROM)\s+public\.(wallets?|wallet_\w+|refunds?)\b/i);
  });
});
