import { describe, expect, it } from "vitest";
import type { PromotionCampaignPublic, PromotionCampaignPublicLocation } from "@/lib/promotion-campaigns/types";
import { nextVendorEvent, vendorEventItems } from "@/lib/promotion-campaigns/vendor-events";

const location = (id: string, startsOn: string, endsOn: string): PromotionCampaignPublicLocation => ({
  id, name: `Location ${id}`, address: null, lat: null, lng: null, startsOn, endsOn, opensAt: "10:00", closesAt: "18:00",
});

const product = (id: string, price = 10) => ({ id, name: `Item ${id}`, kind: "product" as const, price, imageUrl: null });

const campaign: PromotionCampaignPublic = {
  id: "c1", slug: "fair", title: "Fair", summary: "", description: "", posterUrl: null, operatingHours: null,
  startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-12-31T00:00:00Z", visibility: "live",
  locations: [location("ended", "2026-09-01", "2026-09-29"), location("late", "2026-11-10", "2026-11-12"), location("soon", "2026-10-05", "2026-10-06")],
  vendors: [
    {
      vendorId: "v1", vendorName: "Vendor", vendorLogoUrl: null, vendorKind: "event",
      stalls: [
        { registrationId: "r-late", locationId: "late", stallNumber: "B2", stallDescription: "", stallPosterUrl: "", products: [product("a"), product("b", 0)] },
        { registrationId: "r-ended", locationId: "ended", stallNumber: "A0", stallDescription: "", stallPosterUrl: "", products: [product("old")] },
        { registrationId: "r-soon", locationId: "soon", stallNumber: "A1", stallDescription: "", stallPosterUrl: "", products: [product("c")] },
      ],
    },
    { vendorId: "v2", vendorName: "Other", vendorLogoUrl: null, vendorKind: "shop", stalls: [] },
  ],
};

describe("vendor event items", () => {
  it("lists only this vendor's items at locations that have not ended, soonest first, keeping item order", () => {
    const rows = vendorEventItems([campaign], "v1", "2026-09-30");
    expect(rows.map((row) => `${row.location.id}:${row.product.id}`)).toEqual(["soon:c", "late:a", "late:b"]);
    expect(rows[0]).toMatchObject({ campaignSlug: "fair", stallNumber: "A1" });
  });

  it("keeps a location on its last day and drops it the day after", () => {
    expect(vendorEventItems([campaign], "v1", "2026-11-12").map((row) => row.product.id)).toEqual(["a", "b"]);
    expect(vendorEventItems([campaign], "v1", "2026-11-13")).toEqual([]);
  });

  it("finds the soonest upcoming location, or none for a vendor without one", () => {
    expect(nextVendorEvent([campaign], "v1", "2026-09-30")?.location.id).toBe("soon");
    expect(nextVendorEvent([campaign], "v2", "2026-09-30")).toBeNull();
    expect(nextVendorEvent([campaign], "missing", "2026-09-30")).toBeNull();
  });
});
