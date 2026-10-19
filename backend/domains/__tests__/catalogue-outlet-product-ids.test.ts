import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/backend/supabase", () => ({ supabase: {} }));
import { getOutletProductIds } from "@/backend/domains/catalogue";

function resultQuery(result: unknown) {
  const query = {
    eq: vi.fn(),
    in: vi.fn(),
    select: vi.fn(),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  query.eq.mockReturnValue(query);
  query.in.mockReturnValue(query);
  query.select.mockReturnValue(query);
  return query;
}

describe("getOutletProductIds", () => {
  it("batches multiple outlets into one direct-product and one offer query", async () => {
    const directProducts = resultQuery({ data: [{ id: "direct-a" }, { id: "direct-b" }], error: null });
    const offeredProducts = resultQuery({ data: [{ product_id: "shared-a" }], error: null });
    const from = vi.fn()
      .mockReturnValueOnce(directProducts)
      .mockReturnValueOnce(offeredProducts);
    const db = { from } as unknown as SupabaseClient;

    const productIds = await getOutletProductIds(db, ["outlet-a", "outlet-b"]);

    expect(productIds).toEqual(new Set(["direct-a", "direct-b", "shared-a"]));
    expect(from.mock.calls.map(([table]) => table)).toEqual(["products", "outlet_offers"]);
    expect(directProducts.in).toHaveBeenCalledWith("outlet_id", ["outlet-a", "outlet-b"]);
    expect(offeredProducts.in).toHaveBeenCalledWith("outlet_id", ["outlet-a", "outlet-b"]);
    expect(offeredProducts.eq).toHaveBeenCalledWith("status", "active");
  });

  it("returns no product ids without querying when the outlet scope is empty", async () => {
    const from = vi.fn();
    const db = { from } as unknown as SupabaseClient;

    await expect(getOutletProductIds(db, [])).resolves.toEqual(new Set());
    expect(from).not.toHaveBeenCalled();
  });

  it("keeps the single-outlet query contract used by existing callers", async () => {
    const directProducts = resultQuery({ data: [{ id: "direct-a" }], error: null });
    const offeredProducts = resultQuery({ data: [{ product_id: "shared-a" }], error: null });
    const from = vi.fn()
      .mockReturnValueOnce(directProducts)
      .mockReturnValueOnce(offeredProducts);
    const db = { from } as unknown as SupabaseClient;

    await expect(getOutletProductIds(db, "outlet-a")).resolves.toEqual(new Set(["direct-a", "shared-a"]));

    expect(directProducts.eq).toHaveBeenCalledWith("outlet_id", "outlet-a");
    expect(offeredProducts.eq).toHaveBeenCalledWith("outlet_id", "outlet-a");
  });
});
