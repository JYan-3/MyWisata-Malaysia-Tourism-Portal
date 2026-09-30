import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PromotionCampaignPublic, PromotionCampaignPublicVendor } from "@/lib/promotion-campaigns/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { resolvedLanguage: "en" } }),
}));

vi.mock("@/components/customer/promotion-campaign-vendor-card", () => ({
  PromotionCampaignVendorCard: () => <article data-testid="campaign-vendor-card">Vendor card</article>,
}));

import { PromotionCampaignDetailClient } from "@/app/customer/events/[slug]/promotion-campaign-detail-client";

const vendor: PromotionCampaignPublicVendor = {
  vendorId: "4f774340-2bce-de7d-dc27-8208f1286b59",
  vendorName: "Heritage Walk KL",
  vendorLogoUrl: null,
  vendorKind: "shop",
  stalls: [{
    registrationId: "22222222-2222-4222-8222-222222222222",
    locationId: "33333333-3333-4333-8333-333333333333",
    stallNumber: "A1",
    stallDescription: "A real outlet stall.",
    stallPosterUrl: "https://x/stall.jpg",
    products: [{ id: "a2880dc7-4c89-b498-131e-964430c836a9", name: "Jalan Alor Heritage & Food Walk", kind: "product", price: 105.6, imageUrl: null }],
  }],
};

const campaign: PromotionCampaignPublic = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "heritage-walk-kl-current-offers",
  title: "Heritage Walk KL — Local Explorer Picks",
  summary: "Duplicate summary that should not be repeated on the detail page.",
  description: "Full campaign terms including voucher eligibility and unchanged prices.",
  posterUrl: null,
  operatingHours: "10:00 AM - 6:00 PM",
  startsAt: "2026-09-25T12:00:00.000Z",
  endsAt: "2026-10-25T12:00:00.000Z",
  visibility: "live",
  locations: [{
    id: "33333333-3333-4333-8333-333333333333", name: "Petaling Street", address: "Jalan Petaling, Kuala Lumpur",
    lat: 3.1439, lng: 101.6977, startsOn: "2026-09-25", endsOn: "2026-10-25", opensAt: "10:00", closesAt: "18:00",
  }],
  vendors: [vendor],
};

describe("PromotionCampaignDetailClient", () => {
  it("reduces repeated campaign copy while keeping the full description and vendor cards available", () => {
    const markup = renderToStaticMarkup(
      <PromotionCampaignDetailClient slug={campaign.slug} initialCampaign={campaign} initialError={null} />,
    );

    expect(markup).toContain(campaign.title);
    expect(markup).not.toContain(campaign.summary);
    expect(markup).toContain("<details");
    expect(markup).toContain("ui.promotionCampaigns.campaignDetails");
    expect(markup).toContain(campaign.description);
    expect(markup).toContain('data-testid="campaign-vendor-card"');

    const details = markup.match(/<details([^>]*)>([\s\S]*?)<\/details>/);
    expect(details).not.toBeNull();
    expect(details?.[1]).not.toContain("open");
    expect(details?.[2]).toContain(campaign.description);
  });
});
