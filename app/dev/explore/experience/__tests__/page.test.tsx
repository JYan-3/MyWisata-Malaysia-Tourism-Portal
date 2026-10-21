import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCachedComputedActivities: vi.fn() }));

vi.mock("@/lib/cache/catalogue-cache", () => ({
  getCachedComputedActivities: mocks.getCachedComputedActivities,
}));
vi.mock("../experience-client", () => ({
  ExperiencePhotoWallClient: () => null,
}));

import ExperiencePhotoWallPage from "../page";

function activity(id: string, categorySlug: string) {
  return {
    id,
    name: id,
    categorySlug,
    outlet: { id: `outlet-${id}`, state: "Penang" },
  };
}

describe("Experience photo-wall page data", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads the shared catalogue and passes only experience-category listings", async () => {
    const activities = [
      activity("experience-1", "activity"),
      activity("food-1", "food"),
      activity("hotel-1", "accommodation"),
    ];
    mocks.getCachedComputedActivities.mockResolvedValue(activities);

    const page = await ExperiencePhotoWallPage();

    expect(mocks.getCachedComputedActivities).toHaveBeenCalledOnce();
    expect(page.props).toMatchObject({
      initialActivities: [activities[0]],
      dataUnavailable: false,
    });
  });

  it("renders the page's unavailable state when the shared catalogue cannot load", async () => {
    const error = new Error("catalogue offline");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getCachedComputedActivities.mockRejectedValue(error);

    const page = await ExperiencePhotoWallPage();

    expect(page.props).toMatchObject({ initialActivities: [], dataUnavailable: true });
    expect(consoleError).toHaveBeenCalledWith("Failed to load dev experience catalogue", error);
    consoleError.mockRestore();
  });
});
