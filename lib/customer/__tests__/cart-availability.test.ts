import { describe, expect, it } from "vitest";
import type { BookingSlot } from "@/backend/core/types";
import { getCartLineAvailability } from "@/lib/customer/cart-availability";

function slot(overrides: Partial<BookingSlot> = {}): BookingSlot {
  return {
    id: "slot-1",
    activityId: "product-1",
    startsAt: "2026-10-07T05:00:00.000Z",
    endsAt: "2026-10-07T06:00:00.000Z",
    capacity: 20,
    booked: 0,
    status: "available",
    ...overrides,
  };
}

describe("cart line availability", () => {
  const now = new Date("2026-10-06T12:00:00.000Z");

  it("keeps a booking line in checking state until its slot lookup resolves", () => {
    expect(getCartLineAvailability({
      slotId: "slot-1",
      slot: undefined,
      slotLookupStatus: "loading",
      quantity: 1,
      now,
    })).toEqual({ status: "checking", available: false, seatsLeft: undefined });
  });

  it("marks a resolved future slot with enough capacity as available", () => {
    expect(getCartLineAvailability({
      slotId: "slot-1",
      slot: slot({ booked: 4 }),
      slotLookupStatus: "loaded",
      quantity: 2,
      now,
    })).toEqual({ status: "available", available: true, seatsLeft: 16 });
  });

  it("fails closed when a resolved slot is missing, past, full, or short on seats", () => {
    const missing = getCartLineAvailability({ slotId: "slot-1", slot: undefined, slotLookupStatus: "loaded", quantity: 1, now });
    const past = getCartLineAvailability({ slotId: "slot-1", slot: slot({ startsAt: "2026-10-06T11:00:00.000Z" }), slotLookupStatus: "loaded", quantity: 1, now });
    const full = getCartLineAvailability({ slotId: "slot-1", slot: slot({ booked: 20 }), slotLookupStatus: "loaded", quantity: 1, now });
    const tooMany = getCartLineAvailability({ slotId: "slot-1", slot: slot({ booked: 19 }), slotLookupStatus: "loaded", quantity: 2, now });

    expect([missing.status, past.status, full.status, tooMany.status]).toEqual([
      "unavailable",
      "unavailable",
      "unavailable",
      "unavailable",
    ]);
  });

  it("does not label a failed slot lookup as a confirmed inventory result", () => {
    expect(getCartLineAvailability({
      slotId: "slot-1",
      slot: undefined,
      slotLookupStatus: "error",
      quantity: 1,
      now,
    })).toEqual({ status: "error", available: false, seatsLeft: undefined });
  });
});
