import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const raw = readFileSync(resolve(process.cwd(), "supabase/migrations/20261018161000_pelangi_hotel_pilot_data.sql"), "utf8");
const sql = raw.replace(/--.*$/gm, "");

const PELANGI_OUTLET = "5016d273-eb84-d20d-81ab-f9022bf401fa";
const ROOMS = {
  beachfront: "a264a6d5-b5fc-f7e0-ccb4-57aceed4e792",
  garden: "ceb8d447-c612-a82f-95de-c034396724f5",
  family: "94a35c65-b139-4eea-ab4f-76cd72f1a622",
};

describe("Pelangi hotel pilot data migration", () => {
  it("records where every fact came from", () => {
    expect(raw).toMatch(/-- source: https:\/\/www\.pelangiresort\.com\/garden-terrace-room/);
    expect(raw).toMatch(/-- source: https:\/\/www\.pelangiresort\.com\/garden-family-room/);
    expect(raw).toMatch(/-- source: https:\/\/www\.pelangiresort\.com\/seaview/);
    expect(raw).toMatch(/-- source: https:\/\/www\.pelangiresort\.com\/faq/);
  });

  it("fills the Pelangi hotel profile", () => {
    const outletUpdate = sql.match(/UPDATE public\.outlets[\s\S]*?WHERE id = '[^']+';/i)?.[0] ?? "";
    expect(outletUpdate).toContain(PELANGI_OUTLET);
    for (const column of ["hotel_about", "amenity_codes", "check_in_time", "check_out_time", "stay_policies"]) {
      expect(outletUpdate).toContain(column);
    }
    expect(outletUpdate).toContain("'15:00'");
    expect(outletUpdate).toContain("'12:00'");
    expect(outletUpdate).not.toContain("pets_allowed");
  });

  it("gives each of the 3 active rooms the room-detail attribute keys", () => {
    for (const id of Object.values(ROOMS)) {
      const update = sql.match(new RegExp(`UPDATE public\\.products[\\s\\S]*?WHERE id = '${id}'[\\s\\S]*?;`, "i"))?.[0] ?? "";
      for (const key of ["bedType", "maxGuests", "sizeSqm", "view", "smoking", "roomAmenities"]) {
        expect(update, `${id} ${key}`).toContain(`"${key}"`);
      }
      expect(update).toContain("description");
    }
  });

  it("writes only hotel profile and room detail data", () => {
    const touched = [...sql.matchAll(/(?:UPDATE|INSERT INTO|DELETE FROM)\s+public\.(\w+)/gi)].map((m) => m[1]);
    expect(new Set(touched)).toEqual(new Set(["outlets", "products"]));
    expect(sql).not.toMatch(/base_price|outlet_offers|booking_slots|orders|payment|wallet/i);
  });
});
