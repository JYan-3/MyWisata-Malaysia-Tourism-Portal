import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261018160000_hotel_profiles_and_saved_outlets.sql"),
  "utf8",
).replace(/--.*$/gm, "");

describe("hotel profiles and saved outlets migration", () => {
  it("creates the amenity list, submissions and saved-outlet tables with RLS on", () => {
    for (const table of ["hotel_amenities", "hotel_profile_submissions", "customer_saved_outlets"]) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`, "i"));
      expect(sql).toMatch(new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`, "i"));
    }
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS amenity_codes text\[\] NOT NULL DEFAULT '\{\}'/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS hotel_about text/i);
  });

  it("allows only one pending submission per outlet", () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS \w+\s+ON public\.hotel_profile_submissions\s*\(outlet_id\)\s*WHERE status = 'pending_review'/i);
    expect(sql).toMatch(/status text NOT NULL DEFAULT 'pending_review' CHECK \(status IN \('pending_review', 'approved', 'rejected'\)\)/i);
  });

  it("seeds the 12 starting amenities", () => {
    for (const code of ["wifi", "free_parking", "swimming_pool", "gym", "restaurant", "breakfast", "air_conditioning",
      "front_desk_24h", "airport_transfer", "laundry", "accessible", "pets_allowed"]) {
      expect(sql).toContain(`'${code}'`);
    }
  });

  it("lets customers manage only their own saved hotels", () => {
    expect(sql).toMatch(/UNIQUE \(user_id, outlet_id\)/i);
    for (const op of ["SELECT", "INSERT", "DELETE"]) {
      expect(sql).toMatch(new RegExp(`ON public\\.customer_saved_outlets FOR ${op} TO authenticated`, "i"));
    }
    expect(sql).not.toMatch(/ON public\.hotel_profile_submissions FOR/i);
  });

  it("moves saved accommodation rooms to saved hotels and removes only those wishlist rows", () => {
    expect(sql).toMatch(/INSERT INTO public\.customer_saved_outlets[\s\S]*ON CONFLICT \(user_id, outlet_id\) DO NOTHING/i);
    const del = sql.match(/DELETE FROM public\.customer_wishlists[\s\S]*?;/i)?.[0] ?? "";
    expect(del).toContain("11111111-0000-0000-0000-000000000008");
  });

  it("touches no money, order or booking tables", () => {
    expect(sql).not.toMatch(/orders|order_items|wallet|payment|refund|booking_slots/i);
  });
});
