import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(new URL("../20261016022142_commerce_risk_exposure.sql", import.meta.url), "utf8");

describe("commerce risk exposure migration", () => {
  it("reverses vendor settlements for refund, chargeback, and fraud outcomes", () => {
    expect(sql).toContain("NEW.status IN ('refunded', 'chargeback', 'fraud')");
    expect(sql).toContain("public.reverse_order_vendor_settlement(NEW.id, NULL)");
  });

  it("adds vendor-only shortfall metrics to the existing private monthly payout report", () => {
    expect(sql).toContain("vendor_clawback_shortfall_month_rm");
    expect(sql).toContain("vendor_clawback_open_shortfall_rm");
    expect(sql).toContain("settlement_clawback_shortfalls");
    expect(sql).toContain("resolved_at IS NULL");
    expect(sql).toContain("app_private.generate_monthly_payout_report");
  });
});
