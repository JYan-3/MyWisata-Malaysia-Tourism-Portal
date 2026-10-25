import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20261025012659_edit_live_promotion_campaigns.sql", "utf8");

describe("edit live promotion campaigns migration", () => {
  it("replaces only the private save function and keeps its permission, lock and grants", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION app_private\.save_promotion_campaign_draft\(/);
    expect(sql).toMatch(/SECURITY DEFINER\s+SET search_path TO 'public', 'pg_temp'/);
    expect(sql).toContain("PERFORM app_private.lock_event_campaign(p_campaign_id);");
    expect(sql).toContain("public.has_staff_permission(v_actor, 'admin.promotion_campaign.manage')");
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION app_private\.save_promotion_campaign_draft\([^)]*\) FROM PUBLIC, anon, service_role;/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION app_private\.save_promotion_campaign_draft\([^)]*\) TO authenticated;/);
    expect(sql).not.toMatch(/DROP |ALTER TABLE|DELETE FROM|transition_promotion_campaign/i);
  });

  it("lets approved and paused events be edited, but keeps the address and a poster", () => {
    expect(sql).toContain("v_is_live := v_campaign.status IN ('approved', 'paused');");
    expect(sql).toMatch(/btrim\(p_slug\) IS DISTINCT FROM v_campaign\.slug THEN\s+RAISE EXCEPTION 'promotion_campaign_slug_locked'/);
    expect(sql).toMatch(/p_poster_url IS NULL OR btrim\(p_poster_url\) = '' THEN\s+RAISE EXCEPTION 'promotion_campaign_poster_required'/);
  });

  it("still locks events awaiting approval or archived, and checks the optimistic timestamp first", () => {
    expect(sql).toMatch(/ELSIF v_campaign\.status NOT IN \('draft', 'rejected'\) THEN\s+RAISE EXCEPTION 'promotion_campaign_stale'/);
    expect(sql.indexOf("v_campaign.updated_at IS DISTINCT FROM p_expected_updated_at")).toBeLessThan(sql.indexOf("v_is_live := "));
  });

  it("keeps the live status and audits before and after values of a live edit", () => {
    expect(sql).toContain("status = CASE WHEN status = 'rejected' THEN 'draft' ELSE status END");
    expect(sql).toContain("WHEN v_is_live THEN 'promotion_campaign.live_updated'");
    expect(sql).toMatch(/before_data, after_data/);
    expect(sql).toMatch(/v_before := jsonb_build_object\(\s+'title', v_campaign\.title/);
  });
});
