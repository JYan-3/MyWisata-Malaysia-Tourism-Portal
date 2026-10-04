import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("@/backend/supabase", () => ({ supabase: {} }));
import { getProductReviewsPage } from "@/backend/domains/catalogue";

function resultQuery(value: unknown) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
    in: vi.fn(),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(value).then(resolve, reject),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.range.mockReturnValue(query);
  query.in.mockReturnValue(query);
  return query;
}

describe("public product review authors", () => {
  it("loads reviewer names from the public profile view", async () => {
    const userId = "10000000-0000-4000-8000-000000000001";
    const queries = [
      resultQuery({ count: 1, error: null }),
      resultQuery({
        data: [{
          id: "review-1",
          rating: 5,
          title: "Wonderful workshop",
          body: "The host was warm and helpful.",
          created_at: "2026-10-04T09:00:00.000Z",
          user_id: userId,
        }],
        error: null,
      }),
      resultQuery({ data: [{ id: userId, full_name: "Sarah Lim" }], error: null }),
    ];
    const from = vi.fn()
      .mockReturnValueOnce(queries[0])
      .mockReturnValueOnce(queries[1])
      .mockReturnValueOnce(queries[2]);
    const db = { from } as unknown as SupabaseClient;

    const result = await getProductReviewsPage("product-1", {}, db);

    expect(result.items[0]?.authorName).toBe("Sarah L.");
    expect(from.mock.calls.map(([table]) => table)).toEqual(["reviews", "reviews", "public_users"]);
    expect(queries[1].select).toHaveBeenCalledWith(
      "id,rating,title,body,created_at,user_id",
    );
    expect(queries[2].select).toHaveBeenCalledWith("id,full_name");
    expect(queries[2].in).toHaveBeenCalledWith("id", [userId]);
  });
});
