import React from "react";
import { act } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TestEvent, findElements, findOne, installTestDom, type TestDocument, type TestElement } from "@/components/shared/__tests__/render-test-dom";

const mocks = vi.hoisted(() => ({
  params: new URLSearchParams(),
  replace: vi.fn(),
  filterComputedActivities: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => mocks.params,
}));
vi.mock("next/link", () => ({ default: (props: { children?: React.ReactNode }) => <a {...props} /> }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => ({
      "ui.explore.photoWall": "Photo Wall",
      "ui.explore.filterCompare": "Filter & Compare",
      "ui.explore.showMore": `Show more (${options?.count ?? ""})`,
      "ui.explore.sortRecommended": "Recommended",
      "ui.explore.sortPriceAsc": "Price: Low to High",
      "ui.explore.sortRatingDesc": "Top Rated",
      "ui.explore.allExperiences": "All Experiences",
      "ui.explore.results": `${options?.count ?? ""} results`,
      "ui.explore.noExperiences": "No experiences found.",
      "ui.explore.noExperiencesDescription": "Try changing your filters.",
      "ui.explore.title": "Explore Experiences",
      "ui.explore.description": "Find your next experience.",
      "ui.explore.experiencePageTitle": "Explore Experiences",
      "ui.explore.experiencePageDescription": "Browse real activities and compare prices.",
      "ui.explore.eyebrow": "Explore Malaysia",
      "ui.explore.maximumPrice": "Maximum price",
      "ui.explore.sortBy": "Sort by",
      "ui.discovery.bookableOnly": "Bookable Experiences",
      "ui.discovery.clearFilters": "Clear filters",
      "ui.map.types.nature": "Nature",
      "ui.map.types.adventure": "Adventure",
      "ui.map.types.cultural": "Cultural / Heritage",
      "ui.map.types.nightlife": "Nightlife",
      "ui.map.types.wellness": "Wellness / Spa",
      "ui.map.types.water": "Water",
      "ui.map.types.sightseeing": "Sightseeing / Tours",
      "ui.map.allStatesTerritories": "All Malaysia",
      "ui.map.searchExperience": "Search experiences",
    } as Record<string, string>)[key] ?? key,
  }),
}));
vi.mock("@/components/providers/auth", () => ({
  useAuth: () => ({ currentUser: null, loading: false }),
}));
vi.mock("@/components/customer/use-customer-capability-gate", () => ({
  useCustomerCapabilityGate: () => () => true,
}));
vi.mock("@/components/customer/customer-capability-gate-dialog", () => ({
  CustomerCapabilityGateProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/backend/domains/catalogue", () => ({
  STATES_MY: ["All Malaysia", "Penang", "Sabah"],
  filterComputedActivities: mocks.filterComputedActivities,
}));
vi.mock("@/components/customer/activity-card", async () => {
  const React = await import("react");
  const { useWishlist } = await import("@/components/providers/wishlist");
  return {
    ActivityCard: ({ activity }: { activity: { id: string; name: string } }) => {
      useWishlist();
      return React.createElement("article", { "data-testid": `photo-${activity.id}` },
        React.createElement("a", { href: `/customer/activity/${activity.id}` }, activity.name),
      );
    },
  };
});
vi.mock("@/components/customer/discovery-filters", () => ({
  DiscoverySearchField: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <input aria-label="Search experiences" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));
vi.mock("@/components/shared/reference-price", () => ({
  ReferencePrice: ({ amountMYR }: { amountMYR: number }) => <span>{`RM${amountMYR}`}</span>,
}));

import { ExperiencePhotoWallClient } from "../experience-client";

const activities = Array.from({ length: 10 }, (_, index) => ({
  id: `experience-${index + 1}`,
  name: `Experience ${index + 1}`,
  category: "Activity",
  categorySlug: "activity",
  typeSlugs: [index % 2 === 0 ? "nature" : "adventure"],
  price: index + 10,
  rating: 4.5,
  reviews: 3,
  duration: "",
  requiresBooking: index % 2 === 0,
  outlet: { id: `outlet-${index + 1}`, name: `Outlet ${index + 1}`, vendorName: `Vendor ${index + 1}`, city: "George Town", state: "Penang" },
})) as never[];

let createRoot: typeof import("react-dom/client").createRoot;
let document: TestDocument;

function findButton(container: TestElement, name: string) {
  return findOne(container, (element) => element.tagName === "BUTTON" && element.textContent === name);
}

async function click(element: TestElement) {
  await act(async () => {
    element.dispatchEvent(new TestEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

async function render(root: ReturnType<typeof createRoot>, element: React.ReactElement) {
  await act(async () => {
    root.render(element);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("ExperiencePhotoWallClient", () => {
  let container: TestElement;
  let root: ReturnType<typeof createRoot>;

  beforeAll(async () => {
    document = installTestDom();
    ({ createRoot } = await import("react-dom/client"));
  });

  beforeEach(() => {
    mocks.params = new URLSearchParams();
    mocks.replace.mockReset();
    mocks.filterComputedActivities.mockReset().mockImplementation((filters, candidates) => {
      const matches = candidates.filter((activity: { typeSlugs?: string[]; name: string; price: number; requiresBooking: boolean }) => {
        const selectedType = filters.types?.[0]?.split(":")[1];
        return (!selectedType || activity.typeSlugs?.includes(selectedType))
          && (!filters.q || activity.name.toLowerCase().includes(filters.q.toLowerCase()))
          && (filters.priceMax == null || activity.price <= filters.priceMax)
          && (!filters.bookableOnly || activity.requiresBooking);
      });
      return matches;
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container as unknown as Element);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.removeChild(container);
  });

  it("switches between the photo wall and comparison list, and reveals more real product links", async () => {
    await render(root, <ExperiencePhotoWallClient initialActivities={activities} dataUnavailable={false} />);
    expect(findElements(container, (element) => element.getAttribute("data-testid")?.startsWith("photo-") ?? false)).toHaveLength(8);

    await click(findButton(container, "Filter & Compare"));
    expect(findButton(container, "Filter & Compare").getAttribute("aria-pressed")).toBe("true");
    expect(findElements(container, (element) => element.getAttribute("data-testid") === "experience-compare-row")).toHaveLength(8);
    expect(findOne(container, (element) => element.tagName === "A" && element.getAttribute("href")?.startsWith("/customer/activity/experience-1?returnTo=") === true)).toBeTruthy();

    await click(findButton(container, "Show more (2)"));
    expect(findElements(container, (element) => element.getAttribute("data-testid") === "experience-compare-row")).toHaveLength(10);
    await click(findButton(container, "Photo Wall"));
    expect(findButton(container, "Photo Wall").getAttribute("aria-pressed")).toBe("true");
  });

  it("filters by canonical activity type and writes the filter to the URL", async () => {
    await render(root, <ExperiencePhotoWallClient initialActivities={activities} dataUnavailable={false} />);

    await click(findButton(container, "Nature"));

    expect(mocks.filterComputedActivities).toHaveBeenLastCalledWith(
      expect.objectContaining({ categories: ["activity"], types: ["activity:nature"] }),
      activities,
    );
    expect(mocks.replace).toHaveBeenLastCalledWith(expect.stringContaining("type=activity%3Anature"), { scroll: false });
    expect(findElements(container, (element) => element.getAttribute("data-testid")?.startsWith("photo-") ?? false)).toHaveLength(5);
  });

  it("passes the selected sort to the shared catalogue filter and URL", async () => {
    await render(root, <ExperiencePhotoWallClient initialActivities={activities} dataUnavailable={false} />);
    const sortSelect = findOne(container, (element) => element.tagName === "SELECT" && element.getAttribute("aria-label") === "Sort by");

    await act(async () => {
      sortSelect.value = "price_asc";
      sortSelect.dispatchEvent(new TestEvent("change", { bubbles: true }));
      await Promise.resolve();
    });

    expect(mocks.filterComputedActivities).toHaveBeenLastCalledWith(
      expect.objectContaining({ categories: ["activity"], sort: "price_asc" }),
      activities,
    );
    expect(mocks.replace).toHaveBeenLastCalledWith(expect.stringContaining("sort=price_asc"), { scroll: false });
  });
});
