import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PromotionCampaignPublic } from "@/lib/promotion-campaigns/types";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { resolvedLanguage: "en" } }) }));

import { PromotionCampaignSpotlight } from "@/components/customer/promotion-campaign-spotlight";

const campaign: PromotionCampaignPublic = {
  id: "campaign", slug: "sample-event", title: "Sample event",
  summary: "A real campaign summary.", description: "Campaign details",
  posterUrl: null, operatingHours: "10:00 AM - 6:00 PM",
  startsAt: "2026-09-25T12:00:00.000Z", endsAt: "2026-09-26T12:00:00.000Z",
  visibility: "upcoming", locations: [], vendors: [],
};

function getPanelActions(markup: string, labels: string[]) {
  const actionArea = markup.match(/<div(?=[^>]*data-slot="promotion-campaign-actions")[^>]*>([\s\S]*?)<\/div>/);
  expect(actionArea, "campaign actions should have a dedicated region in the content panel").not.toBeNull();
  expect(actionArea?.[0]).toContain("justify-start");
  expect(actionArea?.[0]).toContain("flex-wrap");
  for (const label of labels) expect(actionArea?.[1]).toContain(label);
  return actionArea?.[0] ?? "";
}

describe("promotion campaign home spotlight", () => {
  it("links the upcoming teaser to its campaign details", () => {
    const markup = renderToStaticMarkup(<PromotionCampaignSpotlight campaign={campaign} />);
    expect(markup).toContain("Sample event");
    expect(markup).toContain("ui.promotionCampaigns.upcoming");
    expect(markup).toContain('href="/customer/events/sample-event"');
    const imageIndex = markup.indexOf('data-slot="promotion-campaign-image"');
    const contentIndex = markup.indexOf('data-slot="promotion-campaign-content"');
    const actionsIndex = markup.indexOf('data-slot="promotion-campaign-actions"');
    expect(imageIndex).toBeGreaterThanOrEqual(0);
    expect(contentIndex).toBeGreaterThan(imageIndex);
    expect(actionsIndex).toBeGreaterThan(contentIndex);
    expect(markup).toContain("bg-card");
    expect(markup).toContain("border-highlight-yellow");
    expect(markup).toContain("aspect-[16/9]");
    expect(markup).toContain("lg:aspect-auto");
    expect(markup).toContain("lg:border-l-4");
    expect(markup).toContain("border-t-4");
    expect(markup).not.toContain("opacity-70");
    expect(markup).not.toContain("bg-gradient-to-r");
    expect(getPanelActions(markup, ["ui.promotionCampaigns.exploreCampaign", "ui.promotionCampaigns.allCampaigns"])).toContain("bg-highlight-yellow");
  });

  it("distinguishes an unavailable projection from a genuine empty campaign list", () => {
    const unavailable = renderToStaticMarkup(<PromotionCampaignSpotlight campaign={null} unavailable />);
    const empty = renderToStaticMarkup(<PromotionCampaignSpotlight campaign={null} />);
    expect(unavailable).toContain("ui.promotionCampaigns.unavailableTitle");
    expect(unavailable).toContain("ui.actions.retry");
    expect(empty).toContain("ui.promotionCampaigns.emptyTitle");
    expect(empty).not.toContain("ui.promotionCampaigns.unavailableTitle");
    expect(getPanelActions(unavailable, ["ui.promotionCampaigns.allCampaigns"])).toContain("bg-highlight-yellow");
    expect(getPanelActions(empty, ["ui.promotionCampaigns.allCampaigns"])).toContain("bg-highlight-yellow");
  });

  it("shows external prev/next controls beside the card only when more than one campaign is eligible", () => {
    const second: PromotionCampaignPublic = { ...campaign, id: "campaign-2", slug: "second-event", title: "Second event" };

    const single = renderToStaticMarkup(<PromotionCampaignSpotlight campaign={campaign} campaigns={[campaign]} />);
    expect(single).not.toContain("ui.promotionCampaigns.previous");
    expect(single).not.toContain("ui.promotionCampaigns.next");

    const multiple = renderToStaticMarkup(<PromotionCampaignSpotlight campaign={campaign} campaigns={[campaign, second]} />);
    expect(multiple).toContain("ui.promotionCampaigns.previous");
    expect(multiple).toContain("ui.promotionCampaigns.next");
    expect(multiple).toContain("Sample event");
    expect(multiple).not.toContain("Second event");
  });

  it("renders the event poster without requiring a global image host allowlist", () => {
    const posterCampaign: PromotionCampaignPublic = {
      ...campaign,
      posterUrl: "https://thumb.wikimedia.org/event-poster.jpg",
    };

    const markup = renderToStaticMarkup(<PromotionCampaignSpotlight campaign={posterCampaign} />);

    expect(markup).toContain('src="https://thumb.wikimedia.org/event-poster.jpg"');
    expect(markup.indexOf('src="https://thumb.wikimedia.org/event-poster.jpg"')).toBeLessThan(markup.indexOf('data-slot="promotion-campaign-content"'));
  });
});
