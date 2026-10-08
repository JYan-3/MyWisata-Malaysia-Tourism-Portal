import type { BookingSlot } from "@/backend/core/types";
import { isBookingSlotAvailable } from "@/lib/customer/booking-slot-presenter";

export type BookingSlotLookupStatus = "loading" | "loaded" | "error";
export type CartLineAvailabilityStatus = "available" | "checking" | "error" | "unavailable";

export interface CartLineAvailabilityInput {
  slotId?: string;
  slot?: BookingSlot;
  slotLookupStatus: BookingSlotLookupStatus;
  quantity: number;
  stockLimit?: number | null;
  now?: Date;
}

export interface CartLineAvailability {
  status: CartLineAvailabilityStatus;
  available: boolean;
  seatsLeft?: number;
}

export function getCartLineAvailability({
  slotId,
  slot,
  slotLookupStatus,
  quantity,
  stockLimit,
  now,
}: CartLineAvailabilityInput): CartLineAvailability {
  let seatsLeft: number | undefined;

  if (slotId) {
    if (slotLookupStatus === "loading") return { status: "checking", available: false };
    if (slotLookupStatus === "error") return { status: "error", available: false };
    if (!slot || slot.id !== slotId || !isBookingSlotAvailable(slot, now)) {
      return { status: "unavailable", available: false };
    }

    seatsLeft = slot.capacity - slot.booked;
    if (seatsLeft < quantity) return { status: "unavailable", available: false, seatsLeft };
  }

  if (stockLimit !== undefined && stockLimit !== null && (stockLimit <= 0 || quantity > stockLimit)) {
    return { status: "unavailable", available: false, seatsLeft };
  }

  return { status: "available", available: true, seatsLeft };
}
