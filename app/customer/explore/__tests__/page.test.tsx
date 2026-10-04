import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActivities: vi.fn(),
  getStates: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/cache/catalogue-cache", () => ({ getCachedComputedActivities: mocks.getActivities }));
vi.mock("@/backend/domains/places", () => ({ getStatesWithPlaces: mocks.getStates }));
vi.mock("../explore-client", () => ({ ExploreClient: () => null }));

import ExplorePage from "../page";

function placesQuery(result: unknown) {
  const query: Record<string, unknown> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return query;
}

function upstreamError(status: number) {
  return {
    message: `<!DOCTYPE html><html><head><title>supabase.co | ${status}: Connection timed out</title>`,
  };
}

describe("customer Explore server data fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActivities.mockResolvedValue([]);
    mocks.getStates.mockResolvedValue([]);
    mocks.createClient.mockResolvedValue({
      from: vi.fn(() => placesQuery({ data: [], error: null })),
    });
  });

  it("renders with empty data when Supabase returns transient server errors", async () => {
    mocks.getActivities.mockRejectedValue(upstreamError(522));
    mocks.getStates.mockRejectedValue(upstreamError(503));
    mocks.createClient.mockResolvedValue({
      from: vi.fn(() => placesQuery({ data: null, error: upstreamError(502), status: 502 })),
    });

    const page = await ExplorePage();

    expect(page.props).toMatchObject({
      initialActivities: [],
      statesWithPlaces: [],
      placeCountByState: {},
      dataUnavailable: true,
    });
  });

  it("preserves successful Explore data when one source is temporarily unavailable", async () => {
    const activities = [{ id: "activity-1" }];
    mocks.getActivities.mockResolvedValue(activities);
    mocks.getStates.mockResolvedValue(["Sabah"]);
    mocks.createClient.mockResolvedValue({
      from: vi.fn(() => placesQuery({ data: null, error: upstreamError(503), status: 503 })),
    });

    const page = await ExplorePage();

    expect(page.props).toMatchObject({
      initialActivities: activities,
      statesWithPlaces: ["Sabah"],
      placeCountByState: {},
      dataUnavailable: true,
    });
  });

  it("continues to throw non-transient query errors", async () => {
    const schemaError = { message: "column does not exist", code: "42703" };
    mocks.getActivities.mockRejectedValue(schemaError);

    await expect(ExplorePage()).rejects.toBe(schemaError);
  });
});
