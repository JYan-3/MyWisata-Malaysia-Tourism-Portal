import { describe, expect, it } from "vitest";
import type { DiscoveryResult } from "@/backend/core/types";
import { groupAccommodationByProperty } from "@/lib/customer/discovery-ranking";

function room(id: string, outletId: string, price: number, categorySlug = "accommodation"): DiscoveryResult {
  return {
    id, outletId, name: `Room ${id}`, category: "Stay", categorySlug, description: "", image: "room.jpg", price, rating: 4, reviews: 1,
    duration: "", requiresBooking: true, variants: [], sponsorship: null,
    outlet: { id: outletId, vendorId: "v", name: `Hotel ${outletId}`, category: "Stay", state: "Penang", city: "George Town", address: "", lat: 0, lng: 0, hours: "", verified: true, open: true, rating: 4, reviews: 1, coverUrl: "cover.jpg" },
  } as unknown as DiscoveryResult;
}

describe("groupAccommodationByProperty", () => {
  it("collapses room types into one card per hotel with lowest price and room count", () => {
    const out = groupAccommodationByProperty([room("a", "h1", 300), room("b", "h1", 180), room("c", "h2", 90), room("d", "h1", 250)]);
    expect(out.map((r) => r.id)).toEqual(["a", "c"]);
    expect(out[0].property).toEqual({ roomTypeCount: 3, fromPrice: 180 });
    expect(out[0].name).toBe("Hotel h1");
    expect(out[0].image).toBe("cover.jpg");
  });

  it("leaves non-accommodation results untouched and in order", () => {
    const tour = room("t", "h1", 50, "activity");
    const out = groupAccommodationByProperty([tour, room("a", "h1", 100)]);
    expect(out[0]).toBe(tour);
    expect(out).toHaveLength(2);
  });
});
