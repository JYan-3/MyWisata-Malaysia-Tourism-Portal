import React, { act } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { findElements, findOne, installTestDom, TestEvent, type TestDocument, type TestElement } from "@/components/shared/__tests__/render-test-dom";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      "categories.activity": "Activity",
      "categories.food": "Food",
      "categories.accommodation": "Accommodation",
      "categories.retail": "Retail",
      "ui.map.allCategories": "All Categories",
      "ui.explore.filterByCategory": "Categories",
      "ui.search.category": "Categories",
      "ui.discovery.openNow": "Open now",
      "ui.labels.openNow": "Open now",
      "ui.discovery.advancedFilters": "Search Filter",
      "ui.discovery.openingHours": "Opening hours",
      "ui.discovery.locationAndPrice": "Location and budget",
      "ui.discovery.preferences": "Preferences",
      "ui.discovery.state": "State",
      "ui.discovery.maximumPrice": "Maximum price",
      "ui.discovery.freeOnly": "Free entry",
      "ui.discovery.bookableOnly": "Booking required",
      "ui.discovery.hiddenGemOnly": "Hidden Gem",
      "ui.discovery.familyFriendlyOnly": "Family Friendly",
      "ui.discovery.coupleFriendlyOnly": "Couple Friendly",
      "ui.actions.clearFilters": "Clear filters",
      "ui.discovery.searchLabel": "Search",
      "ui.map.allStatesTerritories": "All states and territories",
    } as Record<string, string>)[key] ?? key,
  }),
}));
vi.mock("@/backend/domains/catalogue", () => ({
  CATEGORIES: [
    { id: "activity", labelKey: "categories.activity" },
    { id: "food", labelKey: "categories.food" },
    { id: "accommodation", labelKey: "categories.accommodation" },
    { id: "retail", labelKey: "categories.retail" },
  ],
  STATES_MY: ["All Malaysia", "Sabah"],
}));
vi.mock("@/components/customer/category-icon", () => ({ CategoryIcon: () => <span aria-hidden="true">•</span> }));

import { CustomerDiscoveryFilterPanel, DiscoveryCategoryFilter } from "@/components/customer/discovery-filters";
import type { DiscoveryQuery } from "@/lib/customer/discovery-query";

const emptyFilters: DiscoveryQuery = {
  q: "",
  state: null,
  categories: [],
  types: [],
  priceMax: null,
  operatingDays: [],
  hoursMode: "during",
  timeAt: null,
  timeFrom: null,
  timeTo: null,
  overnight: false,
  openNow: false,
  freeOnly: false,
  bookableOnly: false,
  hiddenGemOnly: false,
  familyFriendlyOnly: false,
  coupleFriendlyOnly: false,
};

let document: TestDocument;
let container: TestElement;
let createRoot: typeof import("react-dom/client").createRoot;
let root: ReturnType<typeof import("react-dom/client").createRoot>;

async function render(element: React.ReactElement) {
  await act(async () => {
    root.render(element);
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function click(element: TestElement) {
  await act(async () => {
    element.dispatchEvent(new TestEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

beforeAll(async () => {
  document = installTestDom();
  ({ createRoot } = await import("react-dom/client"));
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container as unknown as Element);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.removeChild(container);
});

describe("DiscoveryCategoryFilter sidebar presentation", () => {
  it("keeps native button selection behavior in a vertical category list", async () => {
    const onCategoryChange = vi.fn();
    await render(
      <DiscoveryCategoryFilter
        variant="sidebar"
        category="activity"
        hasActiveFilters={false}
        onCategoryChange={onCategoryChange}
        onClear={() => undefined}
        includeAll
        showClear={false}
      />,
    );

    const categoryButtons = findElements(container, (element) => element.tagName === "BUTTON");
    const activityButton = findOne(container, (element) => element.tagName === "BUTTON" && element.getAttribute("aria-label") === "Activity");
    const categoryList = activityButton.parentNode as TestElement;

    expect(categoryList.className).toContain("flex-col");
    expect(categoryButtons.map((element) => element.getAttribute("type"))).toEqual(["button", "button", "button", "button", "button"]);
    expect(activityButton.getAttribute("aria-pressed")).toBe("true");

    await click(activityButton);

    expect(onCategoryChange).toHaveBeenCalledWith(null);
  });

  it("composes the existing search and advanced filters in sidebar layout without hidden tags", async () => {
    const onChange = vi.fn();
    await render(
      <CustomerDiscoveryFilterPanel
        layout="sidebar"
        value={emptyFilters}
        hasActiveFilters={false}
        onChange={onChange}
        onClear={() => undefined}
        placeholder="Search experiences"
        category={null}
        onCategoryChange={(category) => onChange({ categories: category ? [category] : [] })}
        categoryVariant="sidebar"
        includeAllCategories
        showTypeFilters={false}
        showTagPreferenceFilters={false}
      />,
    );

    expect(findOne(container, (element) => element.tagName === "INPUT" && element.getAttribute("aria-label") === "Search")).not.toBeNull();
    expect(findOne(container, (element) => element.tagName === "BUTTON" && element.getAttribute("aria-label") === "Food")).not.toBeNull();
    expect(findOne(container, (element) => element.tagName === "BUTTON" && element.textContent === "Open now")).not.toBeNull();
    expect(findElements(container, (element) => element.tagName === "SUMMARY").map((element) => element.textContent)).toEqual([
      "Opening hours",
      "Location and budget",
      "Preferences",
    ]);
    for (const label of ["Nature", "Hidden Gem", "Family Friendly", "Couple Friendly"]) {
      expect(findElements(container, (element) => element.getAttribute("aria-label") === label)).toHaveLength(0);
    }
    expect(findOne(container, (element) => element.getAttribute("aria-label") === "Free entry")).not.toBeNull();
    expect(findOne(container, (element) => element.getAttribute("aria-label") === "Booking required")).not.toBeNull();
  });

  it("preserves the existing compact and card category presentations", async () => {
    await render(
      <>
        <DiscoveryCategoryFilter variant="compact" category={null} hasActiveFilters={false} onCategoryChange={() => undefined} onClear={() => undefined} />
        <DiscoveryCategoryFilter variant="cards" category={null} hasActiveFilters={false} onCategoryChange={() => undefined} onClear={() => undefined} />
      </>,
    );

    const categoryButtons = findElements(container, (element) => element.tagName === "BUTTON");
    expect(categoryButtons).toHaveLength(8);
    expect(categoryButtons[0].className).toContain("rounded-full");
    expect(categoryButtons[4].className).toContain("min-h-20");
  });
});
