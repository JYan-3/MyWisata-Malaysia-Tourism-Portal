import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {},
  createClient: vi.fn(),
  getTripById: vi.fn(),
  getTripItems: vi.fn(),
  searchTripActivities: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/backend/domains/trips", () => ({
  createTrip: vi.fn(), deleteTrip: vi.fn(), getTripNameSequence: vi.fn(),
  getTripById: mocks.getTripById, getTripItems: mocks.getTripItems,
}));
vi.mock("@/backend/domains/catalogue", () => ({ searchTripActivities: mocks.searchTripActivities }));
vi.mock("@/lib/cache/catalogue-cache", () => ({ getCachedDiscoveryActivityData: vi.fn(async () => ({ activities: [], outlets: [] })) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { searchTripActivitiesAction } = await import("../actions");

beforeEach(() => {
  vi.resetAllMocks();
  mocks.createClient.mockResolvedValue(mocks.db);
  mocks.getTripById.mockResolvedValue({ id: "owned-trip", start_date: null });
  mocks.getTripItems.mockResolvedValue([{ experience_id: "food" }, { experience_id: null }]);
  mocks.searchTripActivities.mockResolvedValue([{ id: "food", variants: [{ id: "variant" }] }]);
});

describe("Trip discovery purchase-data boundary", () => {
  it("uses owned persisted stops and the authenticated server client for the projected result", async () => {
    const result = await searchTripActivitiesAction("owned-trip", { lat: 3.14, lng: 101.69 });
    expect(mocks.getTripById).toHaveBeenCalledWith("owned-trip", mocks.db);
    expect(mocks.getTripItems).toHaveBeenCalledWith("owned-trip", mocks.db);
    expect(mocks.searchTripActivities).toHaveBeenCalledWith(
      { category: null, near: { lat: 3.14, lng: 101.69 }, sort: "distance_asc" }, ["food"], mocks.db, { activities: [], outlets: [] },
    );
    expect(result).toEqual([{ id: "food", variants: [{ id: "variant" }] }]);
  });

  it("does not load purchase details for a trip the current user cannot access", async () => {
    mocks.getTripById.mockResolvedValue(null);
    await expect(searchTripActivitiesAction("someone-elses-trip")).rejects.toThrow("Trip not found");
    expect(mocks.getTripItems).not.toHaveBeenCalled();
    expect(mocks.searchTripActivities).not.toHaveBeenCalled();
  });

  it.each([{ lat: 91, lng: 101 }, { lat: 3, lng: Number.NaN }])("rejects invalid coordinates before database access: %j", async (near) => {
    await expect(searchTripActivitiesAction("owned-trip", near)).rejects.toThrow();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});
