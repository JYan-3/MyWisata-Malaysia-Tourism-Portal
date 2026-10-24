import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), createServiceClient: vi.fn(), getReviewRatingSummary: vi.fn(), getScopedReviewPage: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: mocks.createServiceClient }));
vi.mock("@/backend/domains/vendor-reviews", () => ({
  getReviewRatingSummary: mocks.getReviewRatingSummary,
  getScopedReviewPage: mocks.getScopedReviewPage,
}));

import { GET } from "../route";

const outletId = "20000000-0000-4000-8000-000000000001";

describe("outlet review list API", () => {
  it("rejects an invalid rating before contacting Supabase", async () => {
    const response = await GET(new Request(`http://localhost/api/outlets/${outletId}/reviews?rating=0`), { params: Promise.resolve({ outletId }) });
    expect(response.status).toBe(400);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("rejects unbounded page sizes", async () => {
    const response = await GET(new Request(`http://localhost/api/outlets/${outletId}/reviews?pageSize=50`), { params: Promise.resolve({ outletId }) });
    expect(response.status).toBe(400);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("keeps hotel review filters and aggregates scoped to accommodation", async () => {
    const outletQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: outletId }, error: null }),
    };
    outletQuery.select.mockReturnValue(outletQuery);
    outletQuery.eq.mockReturnValue(outletQuery);
    const db = { from: vi.fn(() => outletQuery) };
    const service = {};
    mocks.createClient.mockResolvedValue(db);
    mocks.createServiceClient.mockReturnValue(service);
    mocks.getScopedReviewPage.mockResolvedValue({ items: [], page: 1, pageSize: 6, total: 0, totalPages: 1 });
    mocks.getReviewRatingSummary.mockResolvedValue({ rating: 0, total: 0, buckets: [] });

    const response = await GET(new Request(`http://localhost/api/outlets/${outletId}/reviews?category=accommodation&rating=5`), { params: Promise.resolve({ outletId }) });

    expect(response.status).toBe(200);
    expect(mocks.getScopedReviewPage).toHaveBeenCalledWith("outlet", outletId, {
      page: 1,
      pageSize: 6,
      rating: 5,
      productCategorySlug: "accommodation",
    }, db);
    expect(mocks.getReviewRatingSummary).toHaveBeenCalledWith("outlet_accommodation", outletId, service);
  });
});
