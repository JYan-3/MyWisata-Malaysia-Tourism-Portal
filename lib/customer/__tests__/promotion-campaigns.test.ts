import { describe, expect, it } from "vitest";
import { selectFeaturedPublicCampaign, selectFeaturedPublicCampaigns } from "@/lib/customer/promotion-campaigns";
import { campaignCreateSchema, campaignTransitionSchema } from "@/lib/promotion-campaigns/validation";
import type { PromotionCampaignPublic, PromotionCampaignPublicVendor } from "@/lib/promotion-campaigns/types";

const NOW = new Date("2026-09-25T12:00:00.000Z");

const vendor: PromotionCampaignPublicVendor = {
  registrationId: "registration", vendorId: "vendor", vendorName: "Vendor", vendorLogoUrl: null,
  stallNumber: "A1", stallDescription: "A stall description.", stallPosterUrl: "https://x/poster.jpg",
  products: [{ id: "product", name: "Product", price: 10, imageUrl: null }],
};

function publicCampaign(slug: string, startsAt: string, endsAt: string): PromotionCampaignPublic {
  return {
    id: slug, slug, title: slug, summary: slug, description: slug,
    posterUrl: null, operatingHours: "10:00 AM - 6:00 PM",
    startsAt, endsAt, visibility: "upcoming", vendors: [],
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
