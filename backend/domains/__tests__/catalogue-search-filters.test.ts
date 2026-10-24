import { describe, expect, it, vi } from "vitest";
import { countTripPurchasableItems, resolveTripCheckoutLines } from "@/lib/customer/trip-checkout";
import type { TripItem } from "@/backend/domains/trips";

// catalogue.ts builds the browser Supabase singleton at module scope, which
// needs env vars we don't have in unit tests. Every function under test takes
// an injected client, so the default export is never actually used here.
vi.mock("@/backend/supabase", () => ({ supabase: {} }));

const { getOutletActivities, getVendorActivities, searchActivities, searchTripActivities } = await import("@/backend/domains/catalogue");

const OUTLET_FIELDS = {
  address: null,
  operating_hours: null,
  phone: null,
  wheelchair_accessible: null,
  pet_friendly: null,
  vendors: { name: "Test vendor", status: "approved", products: null },
};

const PRODUCTS = [
  {
    id: "free-bookable",
    outlet_id: "outlet-penang",
    name: "Free bookable experience",
    description: null,
    cover_url: null,
    base_price: 0,
    requires_booking: true,
    status: "active",
    review_status: "approved",
    tags: null,
    created_at: "2026-01-01T00:00:00Z",
    attributes: null,
    is_hidden_gem: true,
    type_slugs: ["nature"],
    is_family_friendly: true,
    is_couple_friendly: false,
    place_state: null,
    place_district: null,
    place_lat: null,
    place_lng: null,
    categories: { name: "Activity", slug: "activity" },
    outlet_offers: [],
    product_variants: [],
    price_rules: [],
  },
  {
    id: "paid-bookable",
    outlet_id: "outlet-johor",
    name: "Paid bookable experience",
    description: null,
    cover_url: null,
    base_price: 80,
    requires_booking: true,
    status: "active",
    review_status: "approved",
    tags: null,
    created_at: "2026-01-02T00:00:00Z",
    attributes: null,
    is_hidden_gem: false,
    type_slugs: ["seafood"],
    is_family_friendly: false,
    is_couple_friendly: true,
    place_state: null,
    place_district: null,
    place_lat: null,
    place_lng: null,
    categories: { name: "Food", slug: "food" },
    outlet_offers: [],
    product_variants: [],
    price_rules: [],
  },
  {
    id: "sabah-place",
    outlet_id: "outlet-kuala-lumpur",
    name: "Sabah place experience",
    description: null,
    cover_url: null,
    base_price: 120,
    requires_booking: false,
    status: "active",
    review_status: "approved",
    tags: null,
    created_at: "2026-01-03T00:00:00Z",
    attributes: null,
    is_hidden_gem: false,
    type_slugs: ["adventure"],
    is_family_friendly: true,
    is_couple_friendly: false,
    place_state: "Sabah",
    place_district: "Kinabatangan",
    place_lat: 5.53,
    place_lng: 118.32,
    categories: { name: "Activity", slug: "activity" },
    outlet_offers: [],
    product_variants: [],
    price_rules: [],
  },
  {
    id: "sabah-outlet",
    outlet_id: "outlet-sabah",
    name: "Sabah outlet experience",
    description: null,
    cover_url: null,
    base_price: 40,
    requires_booking: false,
    status: "active",
    review_status: "approved",
    tags: null,
    created_at: "2026-01-04T00:00:00Z",
    attributes: null,
    is_hidden_gem: false,
    type_slugs: null,
    is_family_friendly: false,
    is_couple_friendly: false,
    place_state: null,
    place_district: null,
    place_lat: null,
    place_lng: null,
    categories: { name: "Activity", slug: "activity" },
    outlet_offers: [],
    product_variants: [],
    price_rules: [],
  },
];

const SHARED_PRODUCT = {
  id: "shared-offer",
  vendor_id: "vendor-1",
  outlet_id: null,
  name: "Shared offer experience",
  description: "A shared listing sold by several outlets.",
  cover_url: null,
  base_price: 60,
  requires_booking: false,
  status: "active",
  review_status: "approved",
  tags: null,
  created_at: "2026-01-05T00:00:00Z",
  attributes: null,
  is_hidden_gem: false,
  type_slugs: null,
  is_family_friendly: false,
  is_couple_friendly: false,
  place_state: null,
  place_district: null,
  place_lat: null,
  place_lng: null,
  categories: { name: "Activity", slug: "activity" },
  outlet_offers: [
    { outlet_id: "outlet-johor", price: 10, status: "active" },
    { outlet_id: "outlet-kuala-lumpur", price: 30, status: "active" },
  ],
  product_variants: [],
  price_rules: [],
};

const OUTLETS = [
  { ...OUTLET_FIELDS, operating_hours: { mon: { open: "09:00", close: "18:00" } }, id: "outlet-penang", vendor_id: "vendor-1", name: "Penang outlet", city: "George Town", state: "Penang", lat: 5.41, lng: 100.33, status: "active" },
  { ...OUTLET_FIELDS, id: "outlet-johor", vendor_id: "vendor-1", name: "Johor outlet", city: "Johor Bahru", state: "Johor", lat: 1.49, lng: 103.74, status: "active" },
  { ...OUTLET_FIELDS, id: "outlet-kuala-lumpur", vendor_id: "vendor-1", name: "Kuala Lumpur outlet", city: "Kuala Lumpur", state: "Kuala Lumpur", lat: 3.14, lng: 101.69, status: "active" },
  { ...OUTLET_FIELDS, id: "outlet-sabah", vendor_id: "vendor-1", name: "Sabah outlet", city: "Kota Kinabalu", state: "Sabah", lat: 5.98, lng: 116.07, status: "active" },
];

/** Respect the product projection so lean discovery cannot masquerade as checkout data. */
function makeDb(
  outletRows: unknown[] = OUTLETS,
  productRows: unknown[] = PRODUCTS,
  selectedFields: Record<string, string[]> = {},
  options: { productIdBatches?: string[][]; detailError?: Error; metrics?: unknown[] } = {},
) {
  return {
    from(table: string) {
      let rows = table === "products" ? productRows : table === "outlets" ? outletRows : options.metrics ?? [];
      let includesDetails = false;
      const builder: Record<string, unknown> = {
        select: (columns?: string) => {
          if (columns) selectedFields[table] = [...(selectedFields[table] ?? []), columns];
          includesDetails = Boolean(columns?.includes("product_variants("));
          if (table === "products" && !includesDetails) {
            rows = rows.map((row) => {
              const { product_variants: _variants, price_rules: _rules, ...discovery } = row as Record<string, unknown>;
              return discovery;
            });
          }
          return builder;
        },
        eq: (column: string, value: unknown) => {
          if (table === "products") rows = rows.filter((row) => (row as Record<string, unknown>)[column] === value);
          return builder;
        },
        order: () => builder,
        range: () => builder,
        in: (column: string, values: string[]) => {
          if (table === "products" && column === "id") {
            options.productIdBatches?.push(values);
            rows = rows.filter((row) => values.includes((row as { id: string }).id));
          }
          return builder;
        },
        maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
        then: (resolve: (value: { data: unknown[]; error: Error | null }) => unknown) =>
          resolve({ data: rows, error: includesDetails ? options.detailError ?? null : null }),
      };
      return builder;
    },
  } as never;
}

describe("searchActivities discovery filters", () => {
  it("keeps only free activities", async () => {
    expect((await searchActivities({ freeOnly: true }, makeDb())).map((item) => item.id)).toEqual(["free-bookable"]);
  });

  it("keeps only activities that require booking", async () => {
    expect((await searchActivities({ bookableOnly: true }, makeDb())).map((item) => item.id)).toEqual(["free-bookable", "paid-bookable"]);
  });

  it("matches a place-bound activity by its place state before its provider outlet", async () => {
    expect((await searchActivities({ state: "Sabah" }, makeDb())).map((item) => item.id)).toEqual(["sabah-place", "sabah-outlet"]);
  });

  it("keeps category branches and their type selections with OR semantics", async () => {
    expect((await searchActivities({ categories: ["activity", "food"], types: ["activity:nature", "food:seafood"] }, makeDb())).map((item) => item.id))
      .toEqual(["free-bookable", "paid-bookable"]);
  });

  it("combines the category branch with the StoryMap badge OR group", async () => {
    expect((await searchActivities({ categories: ["activity"], types: ["activity:nature", "activity:adventure"], familyFriendlyOnly: true, coupleFriendlyOnly: true }, makeDb())).map((item) => item.id))
      .toEqual(["free-bookable", "sabah-place"]);
  });

  it("filters by the complete requested time range using outlet operating hours", async () => {
    expect((await searchActivities({ timeFrom: "14:00", timeTo: "16:00" }, makeDb())).map((item) => item.id)).toEqual(["free-bookable"]);
  });

  it("supports selected weekdays and open-at filters", async () => {
    expect((await searchActivities({ hoursMode: "at", timeAt: "10:00", operatingDays: ["mon"] }, makeDb())).map((item) => item.id)).toEqual(["free-bookable"]);
    expect((await searchActivities({ hoursMode: "at", timeAt: "10:00", operatingDays: ["sun"] }, makeDb())).map((item) => item.id)).toEqual([]);
  });

  it("supports detailed multi-period and overnight schedules", async () => {
    const detailedDb = makeDb(OUTLETS.map((outlet) => outlet.id === "outlet-penang" ? { ...outlet, operating_hours: { mon: { periods: [{ open: "09:00", close: "13:00" }, { open: "14:00", close: "18:00" }] }, fri: { periods: [{ open: "18:00", close: "01:00" }] } } } : outlet));
    expect((await searchActivities({ timeFrom: "23:00", timeTo: "01:00", operatingDays: ["fri"], overnight: true }, detailedDb)).map((item) => item.id)).toEqual(["free-bookable"]);
  });

  it("uses the narrow discovery projections and retains fields needed by discovery consumers", async () => {
    const selectedFields: Record<string, string[]> = {};
    const activities = await searchActivities({ q: "Free bookable" }, makeDb(OUTLETS, PRODUCTS, selectedFields));

    expect(activities.map((activity) => activity.id)).toEqual(["free-bookable"]);
    expect(selectedFields.products?.[0]).toContain("description");
    expect(selectedFields.products?.[0]).not.toMatch(/product_variants|price_rules/);
    expect(selectedFields.outlets?.[0]).not.toContain("outlet_pages");
    expect(selectedFields.outlets?.[0]).not.toContain("products(categories");
  });

  it("continues to choose the nearest active outlet for location-ranked shared products", async () => {
    const [activity] = await searchActivities({
      near: { lat: 3.14, lng: 101.69 },
      sort: "distance_asc",
    }, makeDb(OUTLETS, [SHARED_PRODUCT]));

    expect(activity.outlet.id).toBe("outlet-kuala-lumpur");
    expect(activity.price).toBe(30);
    expect(activity.distanceKm).toBeCloseTo(0);
  });
});

describe("Trip purchase details", () => {
  const food = {
    ...SHARED_PRODUCT,
    product_variants: [{
      id: "food-variant", name: "Standard", price_offset: 0, is_active: true,
      inventory: [
        { outlet_id: "outlet-johor", quantity: 10, reserved: 2, low_stock_threshold: 1 },
        { outlet_id: "outlet-kuala-lumpur", quantity: 7, reserved: 1, low_stock_threshold: 1 },
      ],
    }],
    price_rules: [{ id: "private-to-pricing", is_active: true }],
  };

  it("makes the selected in-stock food cartable without hydrating unrelated discovery results", async () => {
    const batches: string[][] = [];
    const activities = await searchTripActivities({ near: { lat: 3.14, lng: 101.69 } }, [food.id, food.id],
      makeDb(OUTLETS, [PRODUCTS[0], food], {}, {
        productIdBatches: batches,
        metrics: [{ product_id: food.id, rating: 4.8, reviews: 12 }],
      }));
    const foodActivity = activities.find((activity) => activity.id === food.id)!;
    expect(batches).toEqual([[food.id]]);
    expect(foodActivity.variants).toEqual([{ id: "food-variant", label: "Standard", priceDelta: 0 }]);
    expect(foodActivity.stockByOutlet?.["outlet-kuala-lumpur"]).toBe(6);
    expect(foodActivity.outlet.id).toBe("outlet-kuala-lumpur");
    expect(foodActivity.price).toBe(30);
    expect(foodActivity.rating).toBe(4.8);
    expect(foodActivity.reviews).toBe(12);
    expect(foodActivity.priceRules).toEqual([]);
    expect(activities.find((activity) => activity.id === PRODUCTS[0].id)?.variants).toEqual([]);

    const stops: TripItem[] = activities.map((activity, index) => ({
      id: `stop-${index}`, trip_id: "trip", experience_id: activity.id, sequence: index,
      scheduled_date: "2026-10-21", scheduled_time: null, created_at: "2026-10-20T00:00:00Z",
      source: "vendor", lat: activity.outlet.lat, lng: activity.outlet.lng,
      label: activity.name, outlet_id: activity.outlet.id,
    }));
    const byId = new Map(activities.map((activity) => [activity.id, activity]));
    expect(countTripPurchasableItems(stops, byId)).toBe(2);
    expect(resolveTripCheckoutLines(stops.filter((stop) => stop.experience_id === food.id), byId, new Map())).toMatchObject({
      lines: [{ activityId: food.id, variantId: "food-variant", outletId: "outlet-kuala-lumpur" }],
      unavailable: [],
    });
  });

  it("keeps an empty itinerary on the lean query and preserves the product approval filters", async () => {
    const batches: string[][] = [];
    const selectedFields: Record<string, string[]> = {};
    const db = makeDb(OUTLETS, [food, { ...food, id: "pending", review_status: "pending" }], selectedFields, { productIdBatches: batches });
    expect((await searchTripActivities({}, [], db)).map((activity) => activity.id)).toEqual([food.id]);
    expect(batches).toEqual([]);
    expect(selectedFields.products).toHaveLength(1);
    expect(selectedFields.products[0]).not.toMatch(/product_variants|price_rules/);
    expect((await searchTripActivities({}, [food.id, "pending"], db)).map((activity) => activity.id)).toEqual([food.id]);
  });

  it("surfaces failed purchase-detail reads instead of treating them as empty inventory", async () => {
    const failure = new Error("purchase details unavailable");
    await expect(searchTripActivities({}, [food.id], makeDb(OUTLETS, [food], {}, { detailError: failure }))).rejects.toThrow(failure);
  });
});

describe("related activity discovery reads", () => {
  it("uses the discovery projection and applies the outlet-specific offer price", async () => {
    const selectedFields: Record<string, string[]> = {};
    const [activity] = await getOutletActivities(
      "outlet-johor",
      "paid-bookable",
      makeDb(OUTLETS, [PRODUCTS[1], SHARED_PRODUCT, PRODUCTS[0]], selectedFields),
    );

    expect(activity.id).toBe("shared-offer");
    expect(activity.outlet.id).toBe("outlet-johor");
    expect(activity.price).toBe(10);
    expect(selectedFields.products?.[0]).toContain("outlet_offers(outlet_id,price,status)");
    expect(selectedFields.products?.[0]).not.toMatch(/product_variants|price_rules/);
  });

  it("keeps vendor matching, exclusion, order, and the three-card cap with discovery fields", async () => {
    const selectedFields: Record<string, string[]> = {};
    const otherVendorOutlet = {
      ...OUTLET_FIELDS,
      id: "outlet-other",
      vendor_id: "vendor-2",
      name: "Other vendor outlet",
      city: "Ipoh",
      state: "Perak",
      lat: 4.6,
      lng: 101.1,
    };
    const vendorProducts = [
      { ...PRODUCTS[0], id: "vendor-direct-1", outlet_id: "outlet-penang" },
      { ...SHARED_PRODUCT, id: "vendor-shared", outlet_offers: [{ outlet_id: "outlet-johor", price: 25, status: "active" }] },
      { ...PRODUCTS[1], id: "vendor-direct-2", outlet_id: "outlet-johor" },
      { ...PRODUCTS[2], id: "vendor-direct-3", outlet_id: "outlet-kuala-lumpur" },
      { ...PRODUCTS[3], id: "vendor-direct-4", outlet_id: "outlet-sabah" },
      { ...PRODUCTS[3], id: "other-vendor-product", outlet_id: "outlet-other" },
    ];
    const activities = await getVendorActivities(
      "vendor-1",
      "vendor-direct-1",
      makeDb([...OUTLETS, otherVendorOutlet], vendorProducts, selectedFields),
    );

    expect(activities.map((activity) => activity.id)).toEqual([
      "vendor-shared",
      "vendor-direct-2",
      "vendor-direct-3",
    ]);
    expect(activities[0].outlet.id).toBe("outlet-johor");
    expect(activities[0].price).toBe(25);
    expect(selectedFields.products?.[0]).not.toMatch(/product_variants|price_rules/);
  });
});
