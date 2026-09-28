import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PromotionCampaignPublic, PromotionCampaignPublicVendor } from "@/lib/promotion-campaigns/types";

const mocks = vi.hoisted(() => ({ getPublicPromotionCampaigns: vi.fn() }));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { resolvedLanguage: "en" } }) }));
vi.mock("@/lib/i18n/server", () => ({ getServerTranslation: vi.fn(async () => ({ t: (key: string) => key })) }));
vi.mock("@/components/customer/use-customer-capability-gate", () => ({
  useCustomerCapabilityGate: () => Object.assign(() => true, { handleResponse: vi.fn(async () => false) }),
}));
vi.mock("@/lib/promotion-campaigns/public", () => ({ getPublicPromotionCampaigns: mocks.getPublicPromotionCampaigns }));

import CustomerEventsPage from "@/app/customer/events/page";

const vendor: PromotionCampaignPublicVendor = {
  registrationId: "22222222-2222-4222-8222-222222222222",
  vendorId: "4f774340-2bce-de7d-dc27-8208f1286b59",
  vendorName: "Heritage Walk KL",
  vendorLogoUrl: null,
  stallNumber: "A1",
  stallDescription: "A real outlet stall.",
  stallPosterUrl: "https://x/stall.jpg",
  products: [{ id: "a2880dc7-4c89-b498-131e-964430c836a9", name: "Jalan Alor Heritage & Food Walk", price: 105.6, imageUrl: null }],
};

const campaign: PromotionCampaignPublic = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "heritage-walk-kl-current-offers",
  title: "Heritage Walk KL — Local Explorer Picks",
  summary: "Explore real Heritage Walk KL offers.",
  description: "Current products and voucher from Heritage Walk KL.",
  posterUrl: null,
  operatingHours: "10:00 AM - 6:00 PM",
  startsAt: "2026-09-25T12:00:00.000Z",
  endsAt: "2026-10-25T12:00:00.000Z",
  visibility: "live",
  vendors: [vendor],
};

describe("customer promotion campaign listing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPublicPromotionCampaigns.mockResolvedValue({ campaigns: [campaign], error: false });
  });

  it("renders live Supabase campaign data in the initial server response", async () => {
    const markup = renderToStaticMarkup(await CustomerEventsPage());

    expect(markup).toContain("ui.promotionCampaigns.pageTitle");
    expect(markup).toContain(campaign.title);
    expect(markup).toContain("Heritage Walk KL");
    expect(markup).not.toContain("ui.promotionCampaigns.loading");
    expect(markup).toContain('href="/customer/events/heritage-walk-kl-current-offers"');
    expect(mocks.getPublicPromotionCampaigns).toHaveBeenCalledOnce();
  });

  it("shows campaign timing and a single count-aware action for a three-card preview", async () => {
    const campaignWithSixVendors: PromotionCampaignPublic = {
      ...campaign,
      vendors: Array.from({ length: 6 }, (_, index) => ({
        ...vendor,
        registrationId: `registration-${index}`,
        vendorId: `vendor-${index}`,
        vendorName: `Vendor ${index}`,
      })),
    };
    mocks.getPublicPromotionCampaigns.mockResolvedValueOnce({ campaigns: [campaignWithSixVendors], error: false });

    const markup = renderToStaticMarkup(await CustomerEventsPage());

    expect(markup).toContain("ui.promotionCampaigns.endsAt");
    expect(markup).toContain("ui.promotionCampaigns.vendorCount");
    expect(markup).toContain("ui.promotionCampaigns.viewAllVendors");
    expect(markup).toContain("ui.promotionCampaigns.previewVendorCount");
    expect(markup).toContain("xl:grid-cols-3");
    expect(markup.match(/href="\/customer\/events\/heritage-walk-kl-current-offers"/g)).toHaveLength(1);
  });

  it("labels the start date for an upcoming campaign", async () => {
    mocks.getPublicPromotionCampaigns.mockResolvedValueOnce({
      campaigns: [{ ...campaign, visibility: "upcoming" }],
      error: false,
    });

    const markup = renderToStaticMarkup(await CustomerEventsPage());

    expect(markup).toContain("ui.promotionCampaigns.startsAt");
    expect(markup).not.toContain("ui.promotionCampaigns.endsAt");
  });

  it("shows a recoverable error when the server projection is unavailable", async () => {
    mocks.getPublicPromotionCampaigns.mockResolvedValueOnce({ campaigns: [], error: true });

    const markup = renderToStaticMarkup(await CustomerEventsPage());

    expect(markup).toContain("ui.promotionCampaigns.loadError");
    expect(markup).not.toContain("ui.promotionCampaigns.loading");
  });
});
