import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EventPartner } from "@/components/customer/event-partners-section";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) => key === "ui.eventPartners.next"
      ? `${values?.event} · ${values?.location} · ${values?.dates}`
      : key,
    i18n: { resolvedLanguage: "en" },
  }),
}));

import { EventPartnersSection } from "@/components/customer/event-partners-section";

const partner: EventPartner = {
  id: "partner-1",
  name: "Penang Crafts",
  logoUrl: null,
  coverUrl: null,
  description: "A local craft vendor.",
  next: {
    campaignTitle: "Heritage Market",
    locationName: "George Town",
    startsOn: "2026-10-10",
    endsOn: "2026-10-11",
  },
};

describe("Event Featured Partners", () => {
  it("shows location and event schedule in the shared caption and retains Info details", () => {
    const markup = renderToStaticMarkup(<EventPartnersSection partners={[partner]} featured />);

    expect(markup).toContain("bg-gradient-to-t from-primary/95 via-primary/40 to-transparent");
    expect(markup).toContain("group-focus-within:opacity-100");
    expect(markup).toContain("George Town");
    expect(markup).toContain("Heritage Market");
    expect(markup).toContain('aria-controls="event-partner-details-partner-1"');
    expect(markup).toContain('id="event-partner-details-partner-1"');
    expect(markup).toContain('id="event-featured-partners-heading" class="flex items-center gap-2 font-[family-name:var(--font-display)] text-2xl');
  });
});
