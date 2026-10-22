import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock("@/backend/supabase", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  return {
    supabase: createClient("https://cart.test", "test-anon-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: request },
    }),
  };
});

import { addToCart, getCart, updateCartQty, updateCartStayDetails } from "../commerce";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260905062500_cart_last_added_order.sql",
);

let persistedRows: object[];
let productCategory = "food";

function jsonResponse(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function cartRow(quantity = 1, id = "line-1") {
  return {
    id,
    variant_id: "variant-1",
    slot_id: null,
    outlet_id: "outlet-1",
    quantity,
    unit_price: 15,
    stay_details: null,
    product_variants: { product_id: "product-1" },
    booking_slots: null,
  };
}

async function asRequest(input: RequestInfo | URL, init?: RequestInit) {
  return input instanceof Request ? input : new Request(input, init);
}

describe("cart recency ordering", () => {
  beforeEach(() => {
    request.mockReset();
    persistedRows = [cartRow()];
    productCategory = "food";
    request.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const current = await asRequest(input, init);
      const url = new URL(current.url);
      if (url.pathname.endsWith("/carts")) return jsonResponse([{ id: "cart-1" }]);
      if (url.pathname.endsWith("/products")) return jsonResponse([{ id: "product-1", categories: { slug: productCategory } }]);
      if (current.method === "GET" && url.pathname.endsWith("/cart_items")) {
        return jsonResponse(persistedRows);
      }
      if (current.method === "PATCH" && url.pathname.endsWith("/cart_items")) {
        const body = JSON.parse(await current.clone().text());
        const id = url.searchParams.get("id")?.replace("eq.", "");
        persistedRows = persistedRows.map((row) => (row as { id: string }).id === id ? { ...row, stay_details: body.stay_details } : row);
        return jsonResponse([{ id }]);
      }
      return jsonResponse([]);
    });
  });

  it("requests cart lines from the most recently added to the oldest", async () => {
    await getCart("alice");

    const cartItemsRequest = request.mock.calls
      .map(([input, init]) => input instanceof Request ? input : new Request(input, init))
      .find((current) => current.method === "GET" && new URL(current.url).pathname.endsWith("/cart_items"));

    expect(new URL(cartItemsRequest!.url).searchParams.get("order"))
      .toBe("last_added_at.desc,created_at.desc,id.desc");
  });

  it("refreshes recency when an existing line is explicitly added again", async () => {
    await addToCart("alice", {
      activityId: "product-1",
      variantId: "variant-1",
      outletId: "outlet-1",
      qty: 2,
    });

    const updateRequest = request.mock.calls
      .map(([input, init]) => input instanceof Request ? input : new Request(input, init))
      .find((current) => current.method === "PATCH" && new URL(current.url).pathname.endsWith("/cart_items"));
    const body = JSON.parse(await updateRequest!.clone().text());

    expect(body.quantity).toBe(3);
    expect(body.last_added_at).toEqual(expect.any(String));
  });

  it("does not move a line when its quantity is changed from the cart", async () => {
    await updateCartQty("alice", "line-1", 4);

    const updateRequest = request.mock.calls
      .map(([input, init]) => input instanceof Request ? input : new Request(input, init))
      .find((current) => current.method === "PATCH" && new URL(current.url).pathname.endsWith("/cart_items"));
    const body = JSON.parse(await updateRequest!.clone().text());

    expect(body).toEqual({ quantity: 4 });
  });

  it("updates the selected cart row by its persisted UUID", async () => {
    await updateCartQty("alice", "visible-line", 4);

    const updateRequest = request.mock.calls
      .map(([input, init]) => input instanceof Request ? input : new Request(input, init))
      .find((current) => current.method === "PATCH" && new URL(current.url).pathname.endsWith("/cart_items"));

    expect(new URL(updateRequest!.url).searchParams.get("id")).toBe("eq.visible-line");
  });

  it("saves accommodation guest details to the exact account-owned cart row", async () => {
    productCategory = "accommodation";
    const stayDetails = { primaryGuestName: "Nur Aisyah", additionalGuestNames: ["Sam Lee"], adults: 2, estimatedArrival: "unknown" as const, specialRequest: "Quiet room" };

    const nextItems = await updateCartStayDetails("alice", "line-1", stayDetails);
    const updateRequest = request.mock.calls
      .map(([input, init]) => input instanceof Request ? input : new Request(input, init))
      .find((current) => current.method === "PATCH" && new URL(current.url).pathname.endsWith("/cart_items"));
    const body = JSON.parse(await updateRequest!.clone().text());

    expect(body.stay_details).toEqual(stayDetails);
    expect(new URL(updateRequest!.url).searchParams.get("id")).toBe("eq.line-1");
    expect(new URL(updateRequest!.url).searchParams.get("cart_id")).toBe("eq.cart-1");
    expect(nextItems[0]?.stayDetails).toEqual(stayDetails);
  });
});

describe("cart recency migration", () => {
  it("backfills existing rows and adds a deterministic cart ordering index", () => {
    expect(existsSync(migrationPath)).toBe(true);
    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toMatch(/add column last_added_at timestamptz/i);
    expect(migration).toMatch(/set last_added_at = created_at/i);
    expect(migration).toMatch(/alter column last_added_at set not null/i);
    expect(migration).toMatch(/cart_id, last_added_at desc, created_at desc, id desc/i);
    expect(migration).not.toMatch(/delete\s+from\s+cart_items/i);
  });
});
