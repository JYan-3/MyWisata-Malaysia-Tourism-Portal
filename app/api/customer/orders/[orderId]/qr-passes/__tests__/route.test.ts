import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser }, from: mocks.from })) }));

import { GET } from "../route";
import { verifyTicketPassToken } from "@/lib/tickets/tokens";
import { verifyFoodFulfilmentToken } from "@/lib/food/food-fulfilment-token";
import { verifyEventPickupToken } from "@/lib/events/event-pickup-token";

function query(data: unknown, error: { code: string; message: string } | null = null) {
  const result = Promise.resolve({ data, error });
  const builder: Record<string, unknown> = {};
  for (const key of ["select", "eq"]) builder[key] = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(() => result);
  builder.then = result.then.bind(result);
  return builder;
}

describe("GET customer order QR passes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "customer-1" } }, error: null });
    mocks.from.mockImplementation((table: string) => {
      if (table === "orders") return query({ id: "order-1", status: "paid", user_id: "customer-1" });
      if (table === "bookings") return query([{ id: "booking-1", order_items: { outlet_id: "outlet-1", vendor_id: "vendor-a", outlets: { id: "outlet-1", name: "North Outlet", vendor_id: "vendor-a", vendors: { id: "vendor-a", name: "Vendor A" } } }, ticket_passes: { id: "pass-1", policy: "multi_entry", entry_limit: 3, entries_used: 1, status: "active", valid_from: "2026-09-21T10:00:00Z", valid_until: "2026-10-21T10:00:00Z" } }]);
      return query([{
        outlet_id: "food-outlet",
        vendor_id: "vendor-b",
        product_name: "Nasi Lemak",
        variant_name: "Regular",
        quantity: 2,
        food_fulfilment_mode: "takeaway",
        food_qr_scanned_at: null,
        fulfil_status: "pending",
        products: { categories: { slug: "food" } },
        outlets: { id: "food-outlet", name: "Kedai Makan", vendor_id: "vendor-b", vendors: { id: "vendor-b", name: "Vendor B" } },
      }]);
    });
  });

  it("returns a server-signed token bound to the current database pass", async () => {
    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ orderId: "order-1" }) });
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.data.tickets).toHaveLength(1);
    expect(verifyTicketPassToken(json.data.tickets[0].passToken).claims).toMatchObject({
      bookingId: "booking-1", passId: "pass-1", outletId: "outlet-1", policy: "multi_entry", entryLimit: 3,
    });
    expect(json.data.tickets[0]).toMatchObject({ entriesUsed: 1, validUntil: "2026-10-21T10:00:00Z" });
    expect(json.data.tickets[0]).toMatchObject({ vendorName: "Vendor A", outletName: "North Outlet" });
    expect(json.data.foodOrders[0]).toMatchObject({ outletId: "food-outlet", mode: "takeaway", status: "pending", vendorName: "Vendor B", outletName: "Kedai Makan" });
    expect(verifyFoodFulfilmentToken(json.data.foodOrders[0].foodToken).claims).toMatchObject({ orderId: "order-1", outletId: "food-outlet" });
  });

  it("issues a group-ticket QR with the database guest limit and the matching merchant", async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === "orders") return query({ id: "order-1", status: "paid", user_id: "customer-1" });
      if (table === "bookings") return query([{
        id: "booking-1",
        order_items: { outlet_id: "outlet-a", vendor_id: "vendor-a", outlets: { id: "outlet-a", name: "Outlet A", vendor_id: "vendor-a", vendors: { id: "vendor-a", name: "Vendor A" } } },
        ticket_passes: { id: "pass-group", policy: "group_entry", entry_limit: 5, entries_used: 2, status: "active", valid_from: null, valid_until: null },
      }]);
      return query([]);
    });

    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ orderId: "order-1" }) });
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(verifyTicketPassToken(json.data.tickets[0].passToken).claims).toMatchObject({
      bookingId: "booking-1", passId: "pass-group", outletId: "outlet-a", policy: "group_entry", entryLimit: 5,
    });
    expect(json.data.tickets[0]).toMatchObject({ vendorName: "Vendor A", outletName: "Outlet A", entriesUsed: 2 });
  });

  it.each(["food_fulfilment_mode", "food_qr_scanned_at"])("still returns booking passes when optional food column %s is not migrated", async (column) => {
    let orderItemReads = 0;
    mocks.from.mockImplementation((table: string) => {
      if (table === "orders") return query({ id: "order-1", status: "paid", user_id: "customer-1" });
      if (table === "bookings") return query([{
        id: "booking-1",
        order_items: { outlet_id: "outlet-1", vendor_id: "vendor-a", outlets: { id: "outlet-1", name: "North Outlet", vendor_id: "vendor-a", vendors: { id: "vendor-a", name: "Vendor A" } } },
        ticket_passes: [{ id: "pass-1", policy: "single_entry", entry_limit: 1, entries_used: 0, status: "active", valid_from: null, valid_until: null }],
      }]);
      if (table === "order_items" && orderItemReads++ === 0) return query(null, {
          code: "42703",
          message: `column order_items.${column} does not exist`,
        });
      return query([]);
    });

    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ orderId: "order-1" }) });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.data.tickets).toHaveLength(1);
    expect(verifyTicketPassToken(json.data.tickets[0].passToken).claims).toMatchObject({
      bookingId: "booking-1", passId: "pass-1", outletId: "outlet-1",
    });
    expect(json.data.foodOrders).toEqual([]);
  });

  it("does not hide unrelated food order query failures", async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === "orders") return query({ id: "order-1", status: "paid", user_id: "customer-1" });
      if (table === "bookings") return query([]);
      return query(null, { code: "42501", message: "permission denied for table order_items" });
    });

    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ orderId: "order-1" }) });

    expect(response.status).toBe(500);
  });

  it("does not issue QR tokens for an unpaid order", async () => {
    mocks.from.mockImplementation((table: string) => table === "orders" ? query({ id: "order-1", status: "pending_payment", user_id: "customer-1" }) : query([]));
    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ orderId: "order-1" }) });
    expect(response.status).toBe(409);
  });

  it("reports dine-in arrival separately from food fulfilment", async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === "orders") return query({ id: "order-1", status: "paid", user_id: "customer-1" });
      if (table === "bookings") return query([]);
      return query([{
        outlet_id: "food-outlet", vendor_id: "vendor-b", product_name: "Nasi Lemak", variant_name: null, quantity: 1,
        food_fulfilment_mode: "dine_in", food_qr_scanned_at: "2026-09-21T10:00:00Z", fulfil_status: "pending",
        products: { categories: { slug: "food" } }, outlets: { id: "food-outlet", name: "Kedai Makan", vendor_id: "vendor-b", vendors: { id: "vendor-b", name: "Vendor B" } },
      }]);
    });
    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ orderId: "order-1" }) });
    expect((await response.json()).data.foodOrders[0].status).toBe("checked_in");
  });

  it("reports takeaway as fulfilled only after the outlet records delivery", async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === "orders") return query({ id: "order-1", status: "paid", user_id: "customer-1" });
      if (table === "bookings") return query([]);
      return query([{
        outlet_id: "food-outlet", vendor_id: "vendor-b", product_name: "Nasi Lemak", variant_name: null, quantity: 1,
        food_fulfilment_mode: "takeaway", food_qr_scanned_at: "2026-09-21T10:00:00Z", fulfil_status: "fulfilled",
        products: { categories: { slug: "food" } }, outlets: { id: "food-outlet", name: "Kedai Makan", vendor_id: "vendor-b", vendors: { id: "vendor-b", name: "Vendor B" } },
      }]);
    });
    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ orderId: "order-1" }) });
    expect((await response.json()).data.foodOrders[0].status).toBe("fulfilled");
  });

  it("issues a separate pickup code for each vendor, location, date, and slot", async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === "orders") return query({ id: "order-1", status: "paid", user_id: "customer-1" });
      if (table === "bookings") return query([]);
      return query([
        { vendor_id: "vendor-e", event_location_id: "loc-1", pickup_date: "2099-12-31", pickup_slot_id: "44444444-4444-4444-8444-444444444444", slot_starts_at: "2099-12-31T02:00:00.000Z", product_name: "Kuih", variant_name: "Main hall · 10:00–11:00", quantity: 2, fulfil_status: "pending", vendors: { name: "Kuih Stall" }, outlet_id: null, products: null },
        { vendor_id: "vendor-e", event_location_id: "loc-1", pickup_date: "2099-12-31", pickup_slot_id: "44444444-4444-4444-8444-444444444444", slot_starts_at: "2099-12-31T02:00:00.000Z", product_name: "Teh", variant_name: "Main hall · 10:00–11:00", quantity: 1, fulfil_status: "pending", vendors: { name: "Kuih Stall" }, outlet_id: null, products: null },
        { vendor_id: "vendor-e", event_location_id: "loc-1", pickup_date: "2099-12-31", pickup_slot_id: "55555555-5555-4555-8555-555555555555", slot_starts_at: "2099-12-31T04:00:00.000Z", product_name: "Nasi", variant_name: "Main hall · 12:00–13:00", quantity: 1, fulfil_status: "pending", vendors: { name: "Kuih Stall" }, outlet_id: null, products: null },
        { vendor_id: "vendor-e", event_location_id: "loc-1", pickup_date: "2099-12-30", pickup_slot_id: "slot-old", slot_starts_at: "2099-12-30T04:00:00.000Z", product_name: "Kuih", variant_name: "Main hall · 12:00–13:00", quantity: 1, fulfil_status: "cancelled", vendors: { name: "Kuih Stall" }, outlet_id: null, products: null },
      ]);
    });

    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ orderId: "order-1" }) });
    const pickups = (await response.json()).data.eventPickups;

    expect(pickups).toHaveLength(2);
    const morning = pickups.find((pickup: { pickupLabels: string[] }) => pickup.pickupLabels[0] === "Main hall · 10:00–11:00");
    const afternoon = pickups.find((pickup: { pickupLabels: string[] }) => pickup.pickupLabels[0] === "Main hall · 12:00–13:00");
    expect(morning).toMatchObject({ vendorName: "Kuih Stall", pickupDate: "2099-12-31", pickupLabels: ["Main hall · 10:00–11:00"], status: "pending" });
    expect(morning.items).toEqual([{ name: "Kuih", quantity: 2 }, { name: "Teh", quantity: 1 }]);
    expect(afternoon.items).toEqual([{ name: "Nasi", quantity: 1 }]);
    const verifiedMorning = verifyEventPickupToken(morning.eventToken);
    expect(verifiedMorning.valid).toBe(true);
    expect(verifiedMorning.claims).toMatchObject({ orderId: "order-1", vendorId: "vendor-e", locationId: "loc-1", pickupDate: "2099-12-31", pickupSlotId: "44444444-4444-4444-8444-444444444444" });
    expect(verifyEventPickupToken(afternoon.eventToken).claims).toMatchObject({ pickupSlotId: "55555555-5555-4555-8555-555555555555" });
  });
});
