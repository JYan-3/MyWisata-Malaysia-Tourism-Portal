import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/components/providers/auth", () => ({ useAuth: () => ({ currentUser: null }) }));
vi.mock("@/components/providers/saved-destinations", () => ({
  useSavedDestinations: () => ({ savedStates: new Set<string>(), toggleSaved: vi.fn() }),
}));
vi.mock("@/components/customer/use-customer-capability-gate", () => ({
  useCustomerCapabilityGate: () => () => true,
}));
vi.mock("@/components/customer/activity-card", () => ({ ActivityCard: () => null }));
vi.mock("@/components/customer/vendor-card", () => ({ VendorCard: () => null }));
vi.mock("@/components/customer/save-toggle-button", () => ({
  SaveToggleButton: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
}));
vi.mock("@/components/customer/promotion-campaign-spotlight", () => ({ PromotionCampaignSpotlight: () => null }));
vi.mock("@/components/customer/event-partners-section", () => ({ EventPartnersSection: () => null }));

import { CustomerHomeClient } from "@/app/customer/customer-home-client";

describe("customer home quick search links", () => {
  it("routes each suggested search to the existing customer partner-search route", () => {
    const renderErrors: unknown[][] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      renderErrors.push(args);
    });
    const markup = renderToStaticMarkup(
      <CustomerHomeClient recommended={[]} popular={[]} vendors={[]} campaign={null} />,
    );
    const unexpectedRenderErrors = renderErrors.filter(
      ([message, ...values]) => !(
        String(message).includes("non-boolean attribute") && values.includes("jsx")
      ),
    );
    consoleError.mockRestore();

    const quickSearchMarkup = markup.match(
      /<nav aria-label="ui\.home\.quickSearches"[\s\S]*?<\/nav>/,
    )?.[0] ?? "";
    const searchHrefs = Array.from(quickSearchMarkup.matchAll(/href="([^"]+)"/g), ([, href]) => href);

    expect(unexpectedRenderErrors).toEqual([]);
    expect(searchHrefs).toEqual([
      "/customer/partners?q=Penang",
      "/customer/partners?q=Langkawi",
      "/customer/partners?q=Melaka",
      "/customer/partners?q=Sabah",
    ]);
    for (const label of [
      "ui.home.penangFoodSearch",
      "ui.home.langkawiIslandSearch",
      "ui.home.melakaHeritageSearch",
      "ui.home.sabahNatureSearch",
    ]) {
      expect(quickSearchMarkup).toContain(label);
    }
  });
});
