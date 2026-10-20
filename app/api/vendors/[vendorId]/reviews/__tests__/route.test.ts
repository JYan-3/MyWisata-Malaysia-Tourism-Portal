import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), createServiceClient: vi.fn(), getReviewRatingSummary: vi.fn(), getScopedReviewPage: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: mocks.createServiceClient }));
vi.mock("@/backend/domains/vendor-reviews", () => ({
  getReviewRatingSummary: mocks.getReviewRatingSummary,
  getScopedReviewPage: mocks.getScopedReviewPage,
}));

import { GET } from "../route";

const vendorId = "10000000-0000-4000-8000-000000000001";

describe("vendor review list API", () => {
  it("rejects an invalid rating before contacting Supabase", async () => {
    const response = await GET(new Request(`http://localhost/api/vendors/${vendorId}/reviews?rating=6`), { params: Promise.resolve({ vendorId }) });
    expect(response.status).toBe(400);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("rejects unbounded page sizes", async () => {
    const response = await GET(new Request(`http://localhost/api/vendors/${vendorId}/reviews?pageSize=1000`), { params: Promise.resolve({ vendorId }) });
    expect(response.status).toBe(400);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});
