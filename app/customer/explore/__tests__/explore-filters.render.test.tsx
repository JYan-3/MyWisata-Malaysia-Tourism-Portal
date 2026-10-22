import React from "react";
import { act } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TestEvent, findElements, findOne, installTestDom, type TestDocument, type TestElement } from "@/components/shared/__tests__/render-test-dom";

const mocks = vi.hoisted(() => ({
  params: new URLSearchParams(),
  replace: vi.fn(),
  searchActivities: vi.fn(),
  filterComputedActivities: vi.fn((_filters: unknown, candidates: unknown[]) => candidates),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => mocks.params,
}));
vi.mock("next/link", () => ({ default: (props: { children?: React.ReactNode }) => <a {...props} /> }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => ({
      "ui.explore.destinations": "Destinations",
      "ui.explore.experiences": "Experiences",
      "ui.discovery.state": "State",
      "ui.discovery.maximumPrice": "Maximum price",
      "ui.discovery.priceInvalid": "Enter a value between 0 and 10,000.",
      "ui.discovery.freeOnly": "Free entry",
      "ui.discovery.bookableOnly": "Booking required",
      "ui.discovery.hiddenGemOnly": "Hidden Gem",
      "ui.discovery.familyFriendlyOnly": "Family Friendly",
      "ui.discovery.coupleFriendlyOnly": "Couple Friendly",
      "ui.discovery.showAll": `Show all (${options?.count ?? ""})`,
      "categories.activity": "Activity",
      "categories.food": "Food",
      "categories.accommodation": "Accommodation",
      "categories.retail": "Retail",
      "categories.hiddenGem": "Hidden Gem",
      "ui.discovery.searchLabel": "Search",
      "ui.search.category": "Categories",
      "ui.map.allCategories": "All Categories",
      "ui.explore.sortBy": "Sort by",
      "ui.explore.sortRecommended": "Recommended",
      "ui.explore.sortPriceAsc": "Price: Low to High",
      "ui.explore.sortRatingDesc": "Top Rated",
      "ui.discovery.openingHours": "Opening hours",
      "ui.discovery.locationAndPrice": "Location and budget",
      "ui.discovery.experienceTypes": "Activity types",
      "ui.discovery.preferences": "Preferences",
      "ui.labels.openNow": "Open now",
      "ui.map.moreFilters": "More filters",
      "ui.map.activeFilters": "Active filters",
      "ui.actions.close": "Close",
      "ui.map.types.nature": "Nature",
      "ui.pagination.experiencePages": "Experience pages",
      "ui.pagination.experienceItems": "experiences",
    } as Record<string, string>)[key] ?? key,
  }),
}));
vi.mock("@/backend/domains/catalogue", () => ({
  CATEGORIES: [
    { id: "activity", labelKey: "categories.activity" },
    { id: "food", labelKey: "categories.food" },
    { id: "accommodation", labelKey: "categories.accommodation" },
    { id: "retail", labelKey: "categories.retail" },
    { id: "hidden_gem", labelKey: "categories.hiddenGem" },
  ],
  STATES_MY: ["All Malaysia", "Sabah"],
  searchActivities: mocks.searchActivities,
  filterComputedActivities: mocks.filterComputedActivities,
}));
vi.mock("@/components/customer/activity-card", () => ({ ActivityCard: ({ activity, returnTo, detailsRevealOnHover, hideDiscoveryBadges }: { activity: { id: string; name: string }; returnTo?: string; detailsRevealOnHover?: boolean; hideDiscoveryBadges?: boolean }) => <article data-testid={`activity-${activity.id}`} data-details-reveal={detailsRevealOnHover ? "true" : "false"} data-hide-discovery-badges={hideDiscoveryBadges ? "true" : "false"}>{activity.name}|{returnTo}</article> }));
vi.mock("@/components/demo-map/story-map", () => ({ StoryMap: ({ activities }: { activities: { id: string }[] }) => <output data-testid="story-map-ids">{activities.map((activity) => activity.id).join(",")}</output> }));

import { ExploreClient } from "../explore-client";

const activities = Array.from({ length: 10 }, (_, index) => ({
  id: `result-${index + 1}`,
  name: `Result ${index + 1}`,
  category: "Activity",
  categorySlug: "activity",
  typeSlugs: ["nature"],
  price: 0,
  rating: 5,
  reviews: 1,
  duration: "",
  requiresBooking: true,
  isHiddenGem: true,
  isFamilyFriendly: true,
  isCoupleFriendly: true,
  outlet: { id: "outlet", city: "Kota Kinabalu", state: "Sabah", open: true, verified: true },
})) as never[];

let createRoot: typeof import("react-dom/client").createRoot;
let document: TestDocument;

function button(container: TestElement, name: string) {
  return findOne(container, (element) => element.tagName === "BUTTON" && element.textContent === name);
}

function labelled(container: TestElement, label: string) {
  const matches = findElements(container, (element) => element.getAttribute("aria-label") === label);
  return matches[matches.length - 1] ?? findOne(container, (element) => element.getAttribute("aria-label") === label);
}

async function click(element: TestElement) {
  await act(async () => {
    element.dispatchEvent(new TestEvent("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function setInputValue(input: TestElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
  setter?.call(input, value);
  await act(async () => {
    input.dispatchEvent(new TestEvent("input", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function setSelectValue(select: TestElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(select), "value")?.set;
  setter?.call(select, value);
  await act(async () => {
    select.dispatchEvent(new TestEvent("change", { bubbles: true }));
    await Promise.resolve();
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

describe("ExploreClient URL-backed advanced filters", () => {
  let container: TestElement;
  let root: ReturnType<typeof createRoot>;

  beforeAll(async () => {
    document = installTestDom();
    ({ createRoot } = await import("react-dom/client"));
  });

  beforeEach(() => {
    mocks.params = new URLSearchParams("state=Sabah&category=activity&type=activity%3Anature&priceMax=100&free=1&bookable=1&hiddenGem=1&family=1&couple=1");
    mocks.replace.mockReset().mockImplementation((href: string) => {
      mocks.params = new URL(href, "https://mylawatan.test").searchParams;
    });
    mocks.searchActivities.mockReset().mockResolvedValue(activities);
    mocks.filterComputedActivities.mockReset().mockImplementation((_filters, candidates) => candidates);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container as unknown as Element);
  });

  afterEach(() => {
    vi.useRealTimers();
    act(() => root.unmount());
    document.body.removeChild(container);
  });

  it("keeps Experiences browse controls focused on real categories and hides unsupported type and badge filters", async () => {
    await render(root, <ExploreClient initialActivities={activities} />);
    expect(mocks.filterComputedActivities).toHaveBeenCalledWith({
      q: "", state: "Sabah", categories: ["activity"], types: ["activity:nature"], priceMax: 100,
      operatingDays: [], hoursMode: "during", timeAt: null,
      timeFrom: null, timeTo: null,
      overnight: false, openNow: false,
      freeOnly: true, bookableOnly: true, hiddenGemOnly: true, familyFriendlyOnly: true, coupleFriendlyOnly: true,
    }, activities);
    expect(mocks.searchActivities).not.toHaveBeenCalled();

    expect(findOne(container, (element) => element.getAttribute("data-testid") === "story-map-ids").textContent).toBe(Array.from({ length: 10 }, (_, index) => `result-${index + 1}`).join(","));
    await click(button(container, "Experiences"));
    const experiencesUrl = new URL(String(mocks.replace.mock.lastCall?.[0]), "https://mylawatan.test");
    expect(experiencesUrl.searchParams.get("tab")).toBe("experiences");
    expect(experiencesUrl.searchParams.get("category")).toBe("activity");
    expect(experiencesUrl.searchParams.has("type")).toBe(false);
    expect(experiencesUrl.searchParams.has("hiddenGem")).toBe(false);
    expect(experiencesUrl.searchParams.has("family")).toBe(false);
    expect(experiencesUrl.searchParams.has("couple")).toBe(false);
    expect(labelled(container, "State").value).toBe("Sabah");
    expect(labelled(container, "Maximum price").value).toBe("100");
    expect(labelled(container, "Activity").getAttribute("aria-pressed")).toBe("true");
    expect(labelled(container, "Free entry").getAttribute("aria-pressed")).toBe("true");
    expect(labelled(container, "Booking required").getAttribute("aria-pressed")).toBe("true");
    for (const label of ["Nature", "Hidden Gem", "Family Friendly", "Couple Friendly"]) {
      expect(findElements(container, (element) => element.getAttribute("aria-label") === label)).toHaveLength(0);
    }
    expect(findElements(container, (element) => element.getAttribute("data-testid")?.startsWith("activity-") ?? false)).toHaveLength(8);
    const activityCard = findOne(container, (element) => element.getAttribute("data-testid") === "activity-result-1");
    expect(activityCard.getAttribute("data-details-reveal")).toBe("true");
    expect(activityCard.getAttribute("data-hide-discovery-badges")).toBe("true");
    const categories = findOne(container, (element) => element.tagName === "BUTTON" && element.getAttribute("aria-label") === "Activity").parentNode as TestElement;
    expect(categories.className).toContain("flex-col");
  });

  it("restores the Experiences tab from the URL", async () => {
    mocks.params = new URLSearchParams("tab=experiences");
    await render(root, <ExploreClient initialActivities={activities} />);

    expect(findElements(container, (element) => element.getAttribute("data-testid") === "story-map-ids").length).toBe(0);
    expect(findElements(container, (element) => element.getAttribute("data-testid")?.startsWith("activity-") ?? false)).toHaveLength(8);
  });

  it("keeps the selected tab and current filters in the product return URL", async () => {
    mocks.params = new URLSearchParams("state=Sabah");
    await render(root, <ExploreClient initialActivities={activities} />);
    await click(button(container, "Experiences"));
    await click(button(container, "Open now"));

    const currentUrl = new URL(String(mocks.replace.mock.lastCall?.[0]), "https://mylawatan.test");
    expect(currentUrl.searchParams.get("tab")).toBe("experiences");
    expect(currentUrl.searchParams.get("state")).toBe("Sabah");
    expect(currentUrl.searchParams.get("openNow")).toBe("1");

    const activityCard = findOne(container, (element) => element.getAttribute("data-testid") === "activity-result-1");
    const returnTo = new URL(activityCard.textContent?.split("|").at(-1) ?? "", "https://mylawatan.test");
    expect(returnTo.pathname).toBe("/customer/explore");
    expect(returnTo.searchParams.get("tab")).toBe("experiences");
    expect(returnTo.searchParams.get("state")).toBe("Sabah");
    expect(returnTo.searchParams.get("openNow")).toBe("1");
  });

  it("writes the selected page to the URL and restores its listings and detail return URL", async () => {
    mocks.params = new URLSearchParams("tab=experiences");
    await render(root, <ExploreClient initialActivities={activities} />);

    await click(button(container, "2"));

    const pageUrl = new URL(String(mocks.replace.mock.lastCall?.[0]), "https://mylawatan.test");
    expect(pageUrl.searchParams.get("tab")).toBe("experiences");
    expect(pageUrl.searchParams.get("page")).toBe("2");
    await render(root, <ExploreClient initialActivities={activities} />);

    expect(findElements(container, (element) => element.getAttribute("data-testid")?.startsWith("activity-") ?? false).map((element) => element.getAttribute("data-testid"))).toEqual([
      "activity-result-9",
      "activity-result-10",
    ]);
    const returnTo = new URL(findOne(container, (element) => element.getAttribute("data-testid") === "activity-result-9").textContent?.split("|").at(-1) ?? "", "https://mylawatan.test");
    expect(returnTo.searchParams.get("page")).toBe("2");
  });

  it("resets to the first page after a filter or sort change", async () => {
    mocks.params = new URLSearchParams("tab=experiences&page=2");
    await render(root, <ExploreClient initialActivities={activities} />);

    expect(findElements(container, (element) => element.getAttribute("data-testid")?.startsWith("activity-") ?? false).length).toBe(2);
    await click(button(container, "Open now"));
    expect(new URL(String(mocks.replace.mock.lastCall?.[0]), "https://mylawatan.test").searchParams.has("page")).toBe(false);
    expect(findElements(container, (element) => element.getAttribute("data-testid")?.startsWith("activity-") ?? false).length).toBe(8);

    await click(button(container, "2"));
    await setSelectValue(labelled(container, "Sort by"), "price_asc");
    expect(new URL(String(mocks.replace.mock.lastCall?.[0]), "https://mylawatan.test").searchParams.get("sort")).toBe("price_asc");
    expect(new URL(String(mocks.replace.mock.lastCall?.[0]), "https://mylawatan.test").searchParams.has("page")).toBe(false);
    expect(findElements(container, (element) => element.getAttribute("data-testid")?.startsWith("activity-") ?? false).length).toBe(8);
  });

  it("clamps out-of-range page values to the last available page", async () => {
    mocks.params = new URLSearchParams("tab=experiences&page=99");
    await render(root, <ExploreClient initialActivities={activities} />);

    expect(new URL(String(mocks.replace.mock.lastCall?.[0]), "https://mylawatan.test").searchParams.get("page")).toBe("2");
    expect(findElements(container, (element) => element.getAttribute("data-testid")?.startsWith("activity-") ?? false).length).toBe(2);
  });

  it("shows a mobile filter entry point that opens and closes the shared sidebar", async () => {
    mocks.params = new URLSearchParams("tab=experiences");
    await render(root, <ExploreClient initialActivities={activities} />);

    const filterToggle = button(container, "More filters");
    expect(filterToggle.getAttribute("aria-expanded")).toBe("false");
    expect(findOne(container, (element) => element.getAttribute("id") === "experience-filter-sidebar").className).toContain("hidden");

    await click(filterToggle);
    expect(button(container, "More filters").getAttribute("aria-expanded")).toBe("true");
    expect(findOne(container, (element) => element.getAttribute("id") === "experience-filter-sidebar").className).toContain("block");

    await click(button(container, "Close"));
    expect(button(container, "More filters").getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps Open now at hand and opens opening hours before secondary filter groups", async () => {
    mocks.params = new URLSearchParams();
    await render(root, <ExploreClient initialActivities={activities} />);
    await click(button(container, "Experiences"));

    expect(button(container, "Open now").getAttribute("aria-pressed")).toBe("false");
    await click(button(container, "Open now"));
    expect(button(container, "Open now").getAttribute("aria-pressed")).toBe("true");

    const groups = findElements(container, (element) => element.tagName === "DETAILS");
    expect(groups).toHaveLength(3);
    expect(groups[0].hasAttribute("open")).toBe(true);
    expect(groups.slice(1).every((group) => !group.hasAttribute("open"))).toBe(true);
    expect(findOne(container, (element) => element.tagName === "SUMMARY" && element.textContent === "Opening hours")).not.toBeNull();
    expect(findElements(container, (element) => element.tagName === "SUMMARY" && element.textContent === "Activity types")).toHaveLength(0);
    for (const label of ["Hidden Gem", "Family Friendly", "Couple Friendly"]) {
      expect(findElements(container, (element) => element.getAttribute("aria-label") === label)).toHaveLength(0);
    }
  });

  it("rejects invalid maximum prices without applying them, while accepting a valid amount", async () => {
    mocks.params = new URLSearchParams("priceMax=100");
    await render(root, <ExploreClient initialActivities={activities} />);
    await click(button(container, "Experiences"));
    const priceInput = labelled(container, "Maximum price");
    mocks.searchActivities.mockClear();

    await setInputValue(priceInput, "-100");
    expect(priceInput.getAttribute("aria-invalid")).toBe("true");
    expect(findOne(container, (element) => element.getAttribute("role") === "alert").textContent).toBe("Enter a value between 0 and 10,000.");
    expect(mocks.searchActivities).not.toHaveBeenCalled();
    expect(mocks.searchActivities.mock.calls.some(([query]) => query.priceMax === -100)).toBe(false);

    await setInputValue(priceInput, "10001");
    expect(priceInput.getAttribute("aria-invalid")).toBe("true");
    expect(mocks.searchActivities.mock.calls.some(([query]) => query.priceMax === 10001)).toBe(false);

    await setInputValue(priceInput, "200");
    expect(priceInput.getAttribute("aria-invalid")).toBe("false");
    expect(findElements(container, (element) => element.getAttribute("role") === "alert")).toHaveLength(0);
    expect(mocks.filterComputedActivities).toHaveBeenLastCalledWith(expect.objectContaining({ priceMax: 200 }), activities);
  });

  it("does not expose Hidden Gem as an Experience category because it is a badge collection", async () => {
    mocks.params = new URLSearchParams();
    await render(root, <ExploreClient initialActivities={activities} />);
    await click(button(container, "Experiences"));

    expect(findElements(container, (element) => element.tagName === "BUTTON" && element.textContent === "Hidden Gem")).toHaveLength(0);
    expect(String(mocks.replace.mock.lastCall?.[0])).not.toContain("hiddenGem=1");
    expect(String(mocks.replace.mock.lastCall?.[0])).not.toContain("category=hidden_gem");
  });

  it("sorts the product grid and preserves the selected sort when returning from a detail page", async () => {
    mocks.params = new URLSearchParams("tab=experiences");
    await render(root, <ExploreClient initialActivities={activities} />);

    await setSelectValue(labelled(container, "Sort by"), "price_asc");

    const sortedUrl = new URL(String(mocks.replace.mock.lastCall?.[0]), "https://mylawatan.test");
    expect(sortedUrl.searchParams.get("sort")).toBe("price_asc");
    expect(mocks.filterComputedActivities).toHaveBeenLastCalledWith(expect.objectContaining({ sort: "price_asc", categories: [] }), expect.any(Array));
    const activityCard = findOne(container, (element) => element.getAttribute("data-testid") === "activity-result-1");
    const returnTo = new URL(activityCard.textContent?.split("|").at(-1) ?? "", "https://mylawatan.test");
    expect(returnTo.searchParams.get("tab")).toBe("experiences");
    expect(returnTo.searchParams.get("sort")).toBe("price_asc");
  });

  it("ignores stale activity-type and badge filters on direct Experience URLs", async () => {
    mocks.params = new URLSearchParams("tab=experiences&category=hidden_gem&type=activity%3Anature&hiddenGem=1&family=1&couple=1");
    await render(root, <ExploreClient initialActivities={activities} />);

    expect(mocks.filterComputedActivities).not.toHaveBeenCalled();
    expect(findElements(container, (element) => element.getAttribute("data-testid")?.startsWith("activity-") ?? false)).toHaveLength(8);
    expect(findElements(container, (element) => element.getAttribute("aria-label") === "Nature")).toHaveLength(0);
    expect(findElements(container, (element) => element.getAttribute("aria-label") === "Hidden Gem")).toHaveLength(0);
  });

  it("debounces only text search requests and sends its trimmed value", async () => {
    mocks.params = new URLSearchParams();
    await render(root, <ExploreClient initialActivities={activities} />);
    mocks.searchActivities.mockClear();
    mocks.filterComputedActivities.mockClear();
    await click(button(container, "Experiences"));
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 60_001);

    await setInputValue(labelled(container, "Search"), "  rain forest  ");
    expect(mocks.searchActivities).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(249); });
    expect(mocks.searchActivities).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(mocks.searchActivities).toHaveBeenCalledTimes(1);
    expect(mocks.searchActivities).toHaveBeenLastCalledWith(expect.objectContaining({ q: "rain forest" }));
    expect(mocks.filterComputedActivities).not.toHaveBeenCalled();
  });

  it("shows the localized loading error instead of claiming the catalogue is empty during an outage", async () => {
    mocks.params = new URLSearchParams();
    await render(root, <ExploreClient initialActivities={[]} dataUnavailable />);

    expect(findOne(container, (element) => element.getAttribute("role") === "status").textContent).toBe("ui.states.loadingError");
    expect(findElements(container, (element) => element.textContent === "ui.explore.noExperiences")).toHaveLength(0);
  });
});
