import { beforeEach, describe, expect, it, vi } from "vitest";

const VENDOR_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_VENDOR_ID = "88888888-8888-4888-8888-888888888888";
const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const LOCATION_ID = "33333333-3333-4333-8333-333333333333";
const CUSTOMER_ID = "77777777-7777-4777-8777-777777777777";

const mocks = vi.hoisted(() => ({ authorizeVendor: vi.fn(), from: vi.fn(), outletFilters: [] as string[][], eventVendorFilters: [] as string[] }));
vi.mock("@/lib/vendor-authorization", () => ({ authorizeVendor: mocks.authorizeVendor }));

import { GET } from "../route";

function query(data: unknown, error: { message: string } | null = null) {
  let resolvedData = data;
  const builder: Record<string, unknown> = {};
  for (const key of ["select", "order", "not"]) builder[key] = vi.fn(() => builder);
  builder.eq = vi.fn((column: string, value: string) => {
    if (column === "after_data->>vendor_id") mocks.eventVendorFilters.push(value);
    if (column === "after_data->>vendor_id" && Array.isArray(resolvedData)) {
      resolvedData = resolvedData.filter((row) => row && typeof row === "object" && "after_data" in row && row.after_data && typeof row.after_data === "object" && "vendor_id" in row.after_data && row.after_data.vendor_id === value);
    }
    return builder;
  });
  builder.in = vi.fn((column: string, ids: string[]) => {
    if (column.includes("outlet_id")) mocks.outletFilters.push(ids);
    return builder;
  });
  builder.maybeSingle = vi.fn(() => Promise.resolve({ data: resolvedData, error }));
  builder.then = (onfulfilled: (value: { data: unknown; error: { message: string } | null }) => unknown) => Promise.resolve({ data: resolvedData, error }).then(onfulfilled);
  return builder;
}

describe("Vendor event pickup redemption history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.outletFilters = [];
    mocks.eventVendorFilters = [];
    mocks.authorizeVendor.mockResolvedValue({ ok: true, access: { vendorId: VENDOR_ID, outletIds: [], serviceDb: { from: mocks.from } } });
    mocks.from.mockImplementation((table: string) => {
      if (table === "audit_logs") return query([{
        id: "audit-1",
        actor_id: null,
        entity_id: ORDER_ID,
        created_at: "2026-10-07T02:00:00.000Z",
        after_data: {
          vendor_id: VENDOR_ID,
          location_id: LOCATION_ID,
          pickup_date: "2026-10-07",
          pickup_slot_id: "44444444-4444-4444-8444-444444444444",
          pickup_times: ["2026-10-07T02:00:00.000Z"],
          items: 2,
          item_details: [
            { name: "Kuih", variant: "Main hall · 10:00–11:00", quantity: 2 },
            { name: "Teh", variant: "Main hall · 10:00–11:00", quantity: 1 },
          ],
        },
      }, {
        id: "audit-other-vendor",
        actor_id: null,
        entity_id: "99999999-9999-4999-8999-999999999999",
        created_at: "2026-10-07T03:00:00.000Z",
        after_data: { vendor_id: OTHER_VENDOR_ID, location_id: LOCATION_ID, pickup_date: "2026-10-07", pickup_times: [], items: 1, item_details: [{ name: "Private item", quantity: 1 }] },
      }]);
      if (table === "orders") return query([{ id: ORDER_ID, user_id: CUSTOMER_ID }]);
      if (table === "promotion_campaign_locations") return query([{ id: LOCATION_ID, name: "Main Hall", address: "Kuala Lumpur" }]);
      if (table === "users") return query([{ id: CUSTOMER_ID, full_name: "Aina Customer", email: "aina@example.test" }]);
      return query([]);
    });
  });

  it("shows event pickup scans to an event vendor with no outlets and scopes them by vendor", async () => {
    const response = await GET(new Request(`http://localhost/api/vendors/${VENDOR_ID}/redemptions`), { params: Promise.resolve({ vendorId: VENDOR_ID }) });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.authorizeVendor).toHaveBeenCalledWith(VENDOR_ID, undefined, { allowEventVendor: true });
    expect(payload.data.items).toHaveLength(1);
    expect(mocks.eventVendorFilters).toEqual([VENDOR_ID]);
    expect(payload.data.items[0]).toMatchObject({
      id: "audit-1",
      kind: "event_pickup",
      redeemedAt: "2026-10-07T02:00:00.000Z",
      outlet: { id: LOCATION_ID, name: "Main Hall" },
      item: { code: ORDER_ID.slice(0, 8).toUpperCase(), name: "Kuih, Teh" },
      customer: { name: "Aina Customer", email: "aina@example.test" },
    });
    expect(payload.data.items[0].item.details).toContain("2026-10-07");
    expect(payload.data.items[0].item.details).toMatch(/10:00/i);
    expect(mocks.outletFilters).not.toContainEqual([]);
  });

  it("returns only event pickup entries when the history filter requests them", async () => {
    const response = await GET(new Request(`http://localhost/api/vendors/${VENDOR_ID}/redemptions?kind=event_pickup`), { params: Promise.resolve({ vendorId: VENDOR_ID }) });
    const payload = await response.json();
    expect(payload.data.items.map((row: { kind: string }) => row.kind)).toEqual(["event_pickup"]);
  });
});
