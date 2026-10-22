import { beforeEach, describe, expect, it, vi } from "vitest";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock("@/backend/supabase", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  return {
    supabase: createClient("https://bookings.test", "test-anon-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: request },
    }),
  };
});

import { getSettledBookingsForUser, mapOrder, ORDER_SELECT } from "../commerce";

function response(rows: object[]) {
  return new Response(JSON.stringify(rows), {
    headers: { "content-type": "application/json" },
  });
}

describe("settled customer bookings", () => {
  beforeEach(() => request.mockReset());

  it("filters bookings through their owning paid or completed order and preserves outlet details", async () => {
    const rows = [
      {
        id: "booking-1",
        status: "confirmed",
        order_items: {
          order_id: "order-1",
          product_id: "product-1",
          product_name: "Canopy Walk Ticket",
          outlet_id: "outlet-accurate",
          slot_starts_at: "2026-10-02T03:00:00.000Z",
          quantity: 2,
          orders: { status: "paid" },
        },
        ticket_passes: null,
      },
      {
        id: "booking-2",
        status: "confirmed",
        order_items: {
          order_id: "order-2",
          product_id: "product-2",
          product_name: "Museum Entry",
          outlet_id: "outlet-completed",
          slot_starts_at: "2026-10-03T03:00:00.000Z",
          quantity: 1,
          orders: { status: "completed" },
        },
        ticket_passes: null,
      },
      {
        id: "booking-stay",
        status: "confirmed",
        order_items: {
          order_id: "order-stay",
          product_id: "product-stay",
          product_name: "Hotel Room",
          outlet_id: "outlet-stay",
          slot_starts_at: "2026-10-05T07:00:00.000Z",
          nights: 1,
          quantity: 1,
          products: { categories: { slug: "accommodation" } },
          orders: { status: "paid" },
        },
        ticket_passes: null,
      },
      {
        id: "booking-pending",
        status: "confirmed",
        order_items: {
          order_id: "order-pending",
          product_id: "product-pending",
          product_name: "Unpaid reservation",
          outlet_id: "outlet-pending",
          slot_starts_at: "2026-10-04T03:00:00.000Z",
          quantity: 1,
          orders: { status: "pending_payment" },
        },
        ticket_passes: null,
      },
    ];
    request.mockImplementation(async (input: RequestInfo | URL) => {
      const requestUrl = typeof input === "object" && input !== null && "url" in input
        ? input.url
        : String(input);
      const query = new URL(requestUrl, "https://bookings.test");
      const statusFilter = query.searchParams.get("order_items.orders.status") ?? "";
      const allowedStatuses = statusFilter.match(/^in\.\((.+)\)$/)?.[1]?.split(",") ?? [];
      const matchingRows = rows.filter((row) => allowedStatuses.includes(row.order_items.orders.status));
      return response(matchingRows);
    });

    const bookings = await getSettledBookingsForUser("customer-1");

    expect(bookings).toEqual([
      expect.objectContaining({ id: "booking-1", orderId: "order-1", outletId: "outlet-accurate", qty: 2 }),
      expect.objectContaining({ id: "booking-2", orderId: "order-2", outletId: "outlet-completed", qty: 1 }),
      expect.objectContaining({ id: "booking-stay", categorySlug: "accommodation", nights: 1 }),
    ]);

    const query = new URL(String(request.mock.calls[0]?.[0]));
    expect(query.pathname).toBe("/rest/v1/bookings");
    expect(query.searchParams.get("customer_id")).toBe("eq.customer-1");
    expect(query.searchParams.get("order_items.orders.status")).toBe("in.(paid,completed)");
    expect(query.searchParams.get("select")).toContain("orders!inner(status)");
    expect(query.searchParams.get("select")).toContain("products(categories(slug))");
  });
});

describe("order item accommodation category mapping", () => {
  it("preserves the product category so a one-night stay can show its checkout date", () => {
    const order = mapOrder({
      id: "order-stay",
      user_id: "customer-1",
      status: "paid",
      subtotal: 100,
      discount_amount: 0,
      total_amount: 100,
      payment_method: "stripe_card",
      voucher_code: null,
      created_at: "2026-10-01T00:00:00.000Z",
      order_items: [{
        product_id: "product-stay",
        product_name: "Hotel Room",
        image_url: null,
        variant_name: null,
        slot_starts_at: "2026-10-05T07:00:00.000Z",
        nights: 1,
        unit_price: 100,
        quantity: 1,
        outlet_id: "outlet-stay",
        products: { cover_url: null, categories: { slug: "accommodation" } },
      }],
    } as Parameters<typeof mapOrder>[0]);

    expect(order.items[0]).toMatchObject({ categorySlug: "accommodation", nights: 1 });
    expect(ORDER_SELECT).toContain("products(cover_url,categories(slug))");
  });
});
