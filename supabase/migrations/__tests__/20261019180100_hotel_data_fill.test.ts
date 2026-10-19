import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const raw = readFileSync(resolve(process.cwd(), "supabase/migrations/20261019180100_hotel_data_fill.sql"), "utf8");
const sql = raw.replace(/^--.*$/gm, "");

const PELANGI_OUTLET = "5016d273-eb84-d20d-81ab-f9022bf401fa";
const AMENITY_CODES = new Set(["accessible", "air_conditioning", "airport_transfer", "breakfast", "free_parking", "front_desk_24h", "gym", "laundry", "pets_allowed", "restaurant", "swimming_pool", "wifi"]);
const outletUpdates = [...sql.matchAll(/UPDATE public\.outlets[\s\S]*?WHERE id = '([^']+)';/g)];
const productUpdates = [...raw.matchAll(/-- (.+) -- source: (.+)\nUPDATE public\.products[\s\S]*?WHERE id = '([^']+)';/g)];
const photoInserts = [...sql.matchAll(/INSERT INTO public\.media_assets[\s\S]*?;\n/g)].map((match) => match[0]);

describe("hotel data fill migration", () => {
  it("fills the profile of all 42 hotels besides the Pelangi pilot", () => {
    expect(outletUpdates).toHaveLength(42);
    expect(outletUpdates.map((match) => match[1])).not.toContain(PELANGI_OUTLET);
    for (const [update] of outletUpdates) {
      for (const column of ["hotel_about", "amenity_codes", "check_in_time", "check_out_time", "stay_policies", "wheelchair_accessible", "pet_friendly"]) {
        expect(update).toContain(column);
      }
      const codes = [...(update.match(/ARRAY\[([^\]]*)\]/)?.[1] ?? "").matchAll(/'([^']+)'/g)].map((match) => match[1]);
      for (const code of codes) expect(AMENITY_CODES.has(code), code).toBe(true);
      expect(update.includes("pet_friendly = true")).toBe(codes.includes("pets_allowed"));
    }
  });

  it("gives all 195 room types the room-detail keys and a source", () => {
    expect(productUpdates).toHaveLength(195);
    expect(new Set(productUpdates.map((match) => match[3])).size).toBe(195);
    for (const [update, , source] of productUpdates) {
      expect(source.trim()).toMatch(/^(https?:\/\/\S+|invented for demo)$/);
      for (const key of ["bedType", "maxGuests", "sizeSqm", "view", "smoking", "roomAmenities"]) expect(update).toContain(`"${key}"`);
    }
  });

  it("records a source for every hotel fact", () => {
    for (const label of ["about", "amenities", "check-in/out", "policies"]) {
      expect(raw.match(new RegExp(`-- source \\(${label}\\): (https?://\\S+|invented for demo)$`, "gm"))).toHaveLength(42);
    }
  });

  it("replaces each of the 43 galleries with 4 freely licensed photos and a cover row", () => {
    expect(photoInserts).toHaveLength(43);
    expect(sql.match(/DELETE FROM public\.media_assets WHERE outlet_id = '[^']+' AND product_id IS NULL;/g)).toHaveLength(43);
    expect(raw.match(/^-- photo \d \((this|similar) hotel, [^)]+\): https:\/\/\S+$/gm)).toHaveLength(43 * 4);
    for (const insert of photoInserts) {
      const orders = [...insert.matchAll(/'image', (-?\d+),/g)].map((match) => Number(match[1]));
      expect(orders).toEqual([-1, 0, 1, 2, 3]);
      for (const [, url] of insert.matchAll(/'(https:\/\/[^']+)'/g)) {
        expect(new URL(url).host).toMatch(/^(upload\.wikimedia\.org|images\.unsplash\.com|images\.pexels\.com)$/);
      }
    }
  });

  it("writes only hotel profile, room detail and gallery data", () => {
    const touched = [...sql.matchAll(/(?:UPDATE|INSERT INTO|DELETE FROM)\s+public\.(\w+)/gi)].map((match) => match[1]);
    expect(new Set(touched)).toEqual(new Set(["outlets", "products", "media_assets"]));
    expect(sql).not.toMatch(/base_price|price_|outlet_offers|booking_slots|cover_url|SET name/i);
  });
});
