import { describe, expect, it } from "vitest";
import { selectFeaturedPublicCampaign, selectFeaturedPublicCampaigns } from "@/lib/customer/promotion-campaigns";
import { campaignCreateSchema, campaignLocationSchema, campaignTransitionSchema } from "@/lib/promotion-campaigns/validation";
import { formatEventDateRange, formatEventHours } from "@/lib/promotion-campaigns/locations";
import type { PromotionCampaignPublic, PromotionCampaignPublicVendor } from "@/lib/promotion-campaigns/types";

const NOW = new Date("2026-09-25T12:00:00.000Z");

const vendor: PromotionCampaignPublicVendor = {
  vendorId: "vendor", vendorName: "Vendor", vendorLogoUrl: null, vendorKind: "shop",
  stalls: [{
    registrationId: "registration", locationId: "location",
    stallNumber: "A1", stallDescription: "A stall description.", stallPosterUrl: "https://x/poster.jpg",
    products: [{ id: "product", name: "Product", kind: "product", price: 10, imageUrl: null }],
  }],
};

function publicCampaign(slug: string, startsAt: string, endsAt: string): PromotionCampaignPublic {
  return {
    id: slug, slug, title: slug, summary: slug, description: slug,
    posterUrl: null, operatingHours: "10:00 AM - 6:00 PM",
    startsAt, endsAt, visibility: "upcoming", locations: [], vendors: [],
  };
}

describe("promotion campaign selection", () => {
  it("chooses a public campaign from the server projection by actual boundaries", () => {
    const expired = publicCampaign("expired", "2026-09-24T10:00:00.000Z", "2026-09-25T12:00:00.000Z");
    const later = publicCampaign("later", "2026-09-26T12:00:00.000Z", "2026-09-27T12:00:00.000Z");
    const live = publicCampaign("live", "2026-09-25T11:00:00.000Z", "2026-09-25T15:00:00.000Z");
    const soonerUpcoming = publicCampaign("sooner", "2026-09-25T13:00:00.000Z", "2026-09-26T13:00:00.000Z");
    const eligibleLive = { ...live, vendors: [vendor] };
    const eligibleUpcoming = { ...soonerUpcoming, vendors: [vendor] };
    const eligibleLater = { ...later, vendors: [vendor] };

    expect(selectFeaturedPublicCampaign([expired, eligibleLater, eligibleUpcoming, eligibleLive], NOW)?.slug).toBe("live");
    expect(selectFeaturedPublicCampaign([expired, eligibleLater, eligibleUpcoming], NOW)?.slug).toBe("sooner");
    expect(selectFeaturedPublicCampaign([expired], NOW)).toBeNull();
    expect(selectFeaturedPublicCampaign([soonerUpcoming], NOW)).toBeNull();
  });

  it("excludes a campaign with zero participating vendors even if the window is valid", () => {
    const live = publicCampaign("live", "2026-09-25T11:00:00.000Z", "2026-09-25T15:00:00.000Z");
    expect(selectFeaturedPublicCampaign([live], NOW)).toBeNull();
  });

  it("returns every eligible campaign, live ones first, matching the single-campaign selector's first result", () => {
    const expired = publicCampaign("expired", "2026-09-24T10:00:00.000Z", "2026-09-25T12:00:00.000Z");
    const laterUpcoming = { ...publicCampaign("later", "2026-09-27T12:00:00.000Z", "2026-09-28T12:00:00.000Z"), vendors: [vendor] };
    const soonerUpcoming = { ...publicCampaign("sooner", "2026-09-25T13:00:00.000Z", "2026-09-26T13:00:00.000Z"), vendors: [vendor] };
    const live = { ...publicCampaign("live", "2026-09-25T11:00:00.000Z", "2026-09-25T15:00:00.000Z"), vendors: [vendor] };

    const result = selectFeaturedPublicCampaigns([expired, laterUpcoming, soonerUpcoming, live], NOW);

    expect(result.map((c) => c.slug)).toEqual(["live", "sooner", "later"]);
    expect(result[0].slug).toBe(selectFeaturedPublicCampaign([expired, laterUpcoming, soonerUpcoming, live], NOW)?.slug);
  });
});

describe("promotion campaign request validation", () => {
  const base = {
    title: "Double Eleven experiences",
    slug: "double-eleven-experiences",
    summary: "A short campaign introduction.",
    description: "A longer campaign description for customers.",
    startsAt: "2026-11-10T16:00:00.000Z",
    endsAt: "2026-11-11T16:00:00.000Z",
    posterUrl: "https://x/poster.jpg",
    operatingHours: "10:00 AM - 6:00 PM",
  };

  it("rejects unknown fields and an end that is not after the start", () => {
    expect(campaignCreateSchema.safeParse({ ...base, isFeatured: true }).success).toBe(false);
    expect(campaignCreateSchema.safeParse({ ...base, endsAt: base.startsAt }).success).toBe(false);
  });

  it("requires operating hours and allows a null poster (not yet uploaded)", () => {
    expect(campaignCreateSchema.safeParse({ ...base, operatingHours: "" }).success).toBe(false);
    expect(campaignCreateSchema.safeParse({ ...base, posterUrl: null }).success).toBe(true);
  });

  it("accepts a well-formed draft and only a well-formed submit action", () => {
    expect(campaignCreateSchema.safeParse(base).success).toBe(true);
    expect(campaignTransitionSchema.safeParse({ action: "submit", expectedUpdatedAt: NOW.toISOString() }).success).toBe(true);
    expect(campaignTransitionSchema.safeParse({ action: "reject", expectedUpdatedAt: NOW.toISOString() }).success).toBe(false);
  });
});

describe("event location validation and display", () => {
  const location = {
    name: "Petaling Street", address: "Jalan Petaling, Kuala Lumpur", lat: 3.1439, lng: 101.6977,
    startsOn: "2026-10-01", endsOn: "2026-10-03", opensAt: "10:00", closesAt: "22:00",
  };

  it("accepts a well-formed location and one with no address or pin", () => {
    expect(campaignLocationSchema.safeParse(location).success).toBe(true);
    expect(campaignLocationSchema.safeParse({ ...location, address: null, lat: null, lng: null }).success).toBe(true);
  });

  it("rejects half a pin, a last day before the first, and closing at or before opening", () => {
    expect(campaignLocationSchema.safeParse({ ...location, lng: null }).success).toBe(false);
    expect(campaignLocationSchema.safeParse({ ...location, endsOn: "2026-09-30" }).success).toBe(false);
    expect(campaignLocationSchema.safeParse({ ...location, closesAt: "10:00" }).success).toBe(false);
    expect(campaignLocationSchema.safeParse({ ...location, opensAt: "25:00" }).success).toBe(false);
  });

  it("formats Malaysia calendar dates and wall-clock hours without shifting them by the viewer's timezone", () => {
    expect(formatEventDateRange("2026-10-01", "2026-10-03", "en")).toBe("Oct 1, 2026 – Oct 3, 2026");
    expect(formatEventDateRange("2026-10-01", "2026-10-01", "en")).toBe("Oct 1, 2026");
    expect(formatEventHours("10:00", "22:00", "en")).toBe("10:00 AM – 10:00 PM");
  });
});
