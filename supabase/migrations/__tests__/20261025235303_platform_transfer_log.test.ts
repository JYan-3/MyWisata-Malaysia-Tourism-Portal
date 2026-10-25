import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20261025235303_platform_transfer_log.sql", "utf8");

describe("platform transfer log migration", () => {
  it("keeps the log private, append-only and voidable only with a reason", () => {
    expect(sql).toContain("CREATE TABLE app_private.platform_transfers (");
    expect(sql).toContain("ALTER TABLE app_private.platform_transfers ENABLE ROW LEVEL SECURITY;");
    expect(sql).toContain("REVOKE ALL ON app_private.platform_transfers FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("CONSTRAINT platform_transfers_void_complete CHECK");
    expect(sql).not.toMatch(/DELETE FROM app_private\.platform_transfers|UPDATE app_private\.platform_transfers\s+SET amount_sen/i);
    expect(sql).not.toMatch(/DROP |ALTER TABLE public\.|UPDATE public\.(wallets|order_settlements|withdrawal_requests)/i);
  });

  it("uses Order Breakdown's platform net rule on confirmed settlements only", () => {
    expect(sql).toContain("WHERE status = 'confirmed'");
    expect(sql).toContain("a.status NOT IN ('reversed', 'rejected')");
    expect(sql).toContain("r.status <> 'reversed'");
    expect(sql).toMatch(/sum\(round\(a\.commission_amount \* 100\)\)/);
  });

  it("requires a Super Admin and blocks recording more than is available under a lock", () => {
    const record = sql.slice(sql.indexOf("CREATE FUNCTION app_private.record_platform_transfer"), sql.indexOf("CREATE FUNCTION app_private.void_platform_transfer"));
    expect(record).toContain("IF NOT public.is_super_admin(v_actor) THEN");
    const lock = record.indexOf("pg_advisory_xact_lock(hashtext('app_private.platform_transfers'))");
    const check = record.indexOf("IF p_amount_sen > v_available THEN");
    const insert = record.indexOf("INSERT INTO app_private.platform_transfers");
    expect(lock).toBeGreaterThan(0);
    expect(check).toBeGreaterThan(lock);
    expect(insert).toBeGreaterThan(check);
    expect(record).toContain("RAISE EXCEPTION 'platform_transfer_exceeds_available'");
    expect(record).toContain("p_transferred_on > (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date");
    expect(record).toContain("'platform_transfer.recorded'");
  });

  it("summarises money owed from the authoritative sen wallet columns and pending refunds", () => {
    for (const column of ["earnings_sen", "pending_earnings_sen", "reserved_earnings_sen", "topup_sen"]) expect(sql).toContain(`sum(w.${column})`);
    expect(sql).not.toMatch(/available_balance|pending_balance/);
    expect(sql).toContain("f.status IN ('pending', 'approved')");
  });

  it("exposes only checked entry points to signed-in users and keeps helpers private", () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION app_private\.platform_earned_confirmed_sen\(\), app_private\.platform_transferred_sen\(\)\s+FROM PUBLIC, anon, authenticated, service_role;/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION app_private\.get_platform_funds\(\)[\s\S]*TO authenticated;/);
    for (const fn of ["get_platform_funds", "record_platform_transfer", "void_platform_transfer"]) {
      expect(sql).toMatch(new RegExp(`CREATE FUNCTION public\\.${fn}\\([^)]*\\) RETURNS jsonb\\s+LANGUAGE sql SECURITY INVOKER`));
    }
  });
});
