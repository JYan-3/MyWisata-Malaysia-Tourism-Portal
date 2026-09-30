import { afterEach, describe, expect, it, vi } from "vitest";
import type { PromotionCampaignPublic } from "@/lib/promotion-campaigns/types";

import { resolvePromotionCampaignImages } from "@/lib/promotion-campaigns/images";

const campaign: PromotionCampaignPublic = {
  id: "campaign",
  slug: "sample-campaign",
  title: "Sample campaign",
  summary: "A live campaign",
  description: "Campaign description",
  posterUrl: "https://project.supabase.co/storage/v1/object/public/event-posters/campaigns/poster.jpg",
  operatingHours: "10:00 AM - 6:00 PM",
  startsAt: "2026-09-25T00:00:00.000Z",
  endsAt: "2026-10-25T00:00:00.000Z",
  visibility: "live",
  locations: [],
  vendors: [{
    vendorId: "vendor",
    vendorName: "Vendor",
    vendorLogoUrl: null,
    vendorKind: "shop",
    stalls: [{
      registrationId: "registration",
      locationId: "location",
      stallNumber: "A1",
      stallDescription: "A stall description.",
      stallPosterUrl: "https://project.supabase.co/storage/v1/object/public/event-posters/vendor/stall.jpg",
      products: [{ id: "product", name: "Product", kind: "product", price: 10, imageUrl: "/assets/customer/products/product-real.jpg" }],
    }],
  }],
};

describe("resolvePromotionCampaignImages", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("converts legacy product paths to the shared Supabase product-image URL", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");

    const [resolved] = resolvePromotionCampaignImages([campaign]);

    expect(resolved.vendors[0].stalls[0].products[0].imageUrl).toBe("https://project.supabase.co/storage/v1/object/public/product-images/products/product-real.jpg");
  });

  it("keeps missing and absolute source images unchanged", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    const absolute = "https://project.supabase.co/storage/v1/object/public/product-images/products/product.jpg";
    const value: PromotionCampaignPublic = {
      ...campaign,
      vendors: campaign.vendors.map((vendor) => ({
        ...vendor,
        stalls: vendor.stalls.map((stall) => ({
          ...stall,
          products: stall.products.map((product) => ({ ...product, imageUrl: absolute })),
        })),
      })),
    };

    const [resolved] = resolvePromotionCampaignImages([value]);

    expect(resolved.vendors[0].stalls[0].products[0].imageUrl).toBe(absolute);
  });
});
