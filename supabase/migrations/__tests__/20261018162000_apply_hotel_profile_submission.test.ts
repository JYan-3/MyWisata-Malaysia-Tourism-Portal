import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261018162000_apply_hotel_profile_submission.sql"), "utf8").replace(/--.*$/gm, "");
const fn = sql.match(/CREATE OR REPLACE FUNCTION app_private\.apply_hotel_profile_submission[\s\S]*?\$\$;/i)?.[0] ?? "";

describe("apply hotel profile submission migration", () => {
  it("only applies a submission that is still pending, under a row lock", () => {
    expect(fn).toMatch(/FROM public\.hotel_profile_submissions[\s\S]*?FOR UPDATE/i);
    expect(fn).toMatch(/status <> 'pending_review'[\s\S]*?RAISE EXCEPTION/i);
  });

  it("writes the live hotel profile and keeps the hotel listed", () => {
    for (const column of ["hotel_about", "amenity_codes", "check_in_time", "check_out_time", "stay_policies", "wheelchair_accessible", "pet_friendly"]) {
      expect(fn).toContain(column);
    }
    const outletUpdate = fn.match(/UPDATE public\.outlets[\s\S]*?WHERE[^;]*;/i)?.[0] ?? "";
    expect(outletUpdate).not.toMatch(/\bstatus\s*=/i);
    expect(outletUpdate).not.toMatch(/review_status/i);
  });

  it("replaces the outlet gallery but keeps the logo row", () => {
    expect(fn).toMatch(/DELETE FROM public\.media_assets[\s\S]*product_id IS NULL[\s\S]*<> -1/i);
    expect(fn).toMatch(/INSERT INTO public\.media_assets/i);
  });

  it("marks the submission approved and is callable by the service role only", () => {
    expect(fn).toMatch(/SET status = 'approved'/i);
    expect(sql).toMatch(/SECURITY DEFINER/i);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.apply_hotel_profile_submission\(uuid, uuid, timestamptz\) FROM PUBLIC, anon, authenticated/i);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.apply_hotel_profile_submission\(uuid, uuid, timestamptz\) TO service_role/i);
  });

  it("lets content review history record hotel profiles", () => {
    expect(sql).toMatch(/content_reviews_entity_type_check[\s\S]*'hotel_profile'/i);
  });

  it("applies only the exact version the admin reviewed", () => {
    expect(fn).toMatch(/apply_hotel_profile_submission\(p_submission_id uuid, p_reviewer uuid, p_expected_updated_at timestamptz\)/i);
    expect(fn).toMatch(/updated_at IS DISTINCT FROM p_expected_updated_at[\s\S]*?RAISE EXCEPTION 'hotel_profile_submission_changed'/i);
  });

  it("keeps each photo's alt text when the gallery is replaced", () => {
    expect(fn).toMatch(/DELETE FROM public\.media_assets[\s\S]*RETURNING url, alt_text/i);
    expect(fn).toMatch(/INSERT INTO public\.media_assets \(vendor_id, outlet_id, url, media_type, sort_order, alt_text\)/i);
  });
});
