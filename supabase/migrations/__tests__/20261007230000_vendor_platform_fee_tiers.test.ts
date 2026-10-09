import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261007230000_vendor_platform_fee_tiers.sql"), "utf8");

// Behaviour is proven against a database by supabase/tests/vendor-platform-fee-tiers.sql.
describe("vendor platform fee tiers migration", () => {
  it("keeps tiers server-only and seeds them at the current global rate", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.vendor_fee_tiers");
    expect(sql).toContain("REVOKE ALL ON public.vendor_fee_tiers FROM PUBLIC, anon, authenticated");
    expect(sql).toContain("WHERE key = 'commission.platform_rate'");
  });

  it("refuses to replace a settlement function that drifted", () => {
    expect(sql).toContain("RAISE EXCEPTION 'settlement_definition_drift'");
    expect(sql.indexOf("settlement_definition_drift")).toBeLessThan(sql.indexOf("CREATE OR REPLACE FUNCTION public.settle_order_vendor_earnings"));
  });

  it("charges event lines the event fee per item, capped at the line", () => {
    expect(sql).toContain("COALESCE(li.campaign_fee, v_event_default)");
    expect(sql).toContain("LEAST(v_per_item * v_line_qty, v_line_gross)");
  });

  it("floors the fee at referral payouts and keeps money functions service-only", () => {
    expect(sql).toContain("GREATEST(s.base_fee_sen, v_owed)");
    for (const fn of ["apply_order_platform_fee_floor(UUID)", "settle_order_vendor_earnings(UUID)", "recompute_vendor_fee_tiers()"]) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC, anon, authenticated`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${fn} TO service_role`);
    }
  });

  it("sets event fees through a service-only function because the server role cannot write campaigns", () => {
    const rpc = readFileSync(resolve(process.cwd(), "supabase/migrations/20261008100000_campaign_platform_fee_rpc.sql"), "utf8");
    expect(rpc).toContain("REVOKE ALL ON FUNCTION public.set_campaign_platform_fees(JSONB) FROM PUBLIC, anon, authenticated");
    expect(rpc).toContain("GRANT EXECUTE ON FUNCTION public.set_campaign_platform_fees(JSONB) TO service_role");
    // Only the fee column is written: the UPDATE statement itself never touches updated_at.
    const update = rpc.match(/UPDATE public\.promotion_campaigns[^;]*;/)?.[0] ?? '';
    expect(update).toContain('platform_fee_per_item_sen');
    expect(update).not.toContain('updated_at');
  });
});
