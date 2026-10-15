import type { BookingSlot, ComputedActivity } from "@/backend/core/types";
import type { TripItem } from "@/backend/domains/trips";
import { getActivityCommerceMode } from "@/lib/customer/category-details";
import { groupBookableBookingSlotsByDate } from "@/lib/customer/booking-slot-presenter";
import { getSelectedOutletStock } from "@/lib/customer/outlet-shop";
import { normalizeTripTime, slotClockTime } from "@/lib/customer/trip-time-options";

export interface TripCheckoutLine {
  activityId: string;
  /**
   * A booking-only product can have zero variants — the real `CartItem`
   * contract (`assertCartItemHasBackingRecord`) only requires *either* a
   * variant or a slot, so this is "" (never undefined, to match the shape
   * `useCart().addItem` already expects) when the slot alone backs the line.
   */
  variantId: string;
  outletId: string;
  slotId?: string;
  qty: number;
}

export interface TripCheckoutSkip {
  itemId: string;
  label: string;
}

export interface TripCheckoutResolution {
  lines: TripCheckoutLine[];
  /**
   * Requires a real vendor booking slot but none is open on the item's
   * scheduled day — never invented or nudged to a nearby date; left for the
   * customer to pick manually on the activity page.
   */
  needsSlot: TripCheckoutSkip[];
  /**
   * A vendor listing with nothing that can back a cart line (no variant and no
   * booking) — reported so the customer isn't left wondering where it went.
   */
  unavailable: TripCheckoutSkip[];
}

/** The vendor listing behind a scheduled stop, when that stop is something to buy at all. */
function vendorActivityFor(item: TripItem, activitiesById: Map<string, ComputedActivity>): ComputedActivity | null {
  if (!item.scheduled_date || !item.experience_id) return null;
  const activity = activitiesById.get(item.experience_id);
  return activity && getActivityCommerceMode(activity) === "vendor" ? activity : null;
}

/**
 * How many scheduled stops checkout can put in the cart: the button's count.
 * Booking items count here even though their slot is only checked at checkout.
 */
export function countTripPurchasableItems(items: TripItem[], activitiesById: Map<string, ComputedActivity>): number {
  return items.filter((item) => {
    const activity = vendorActivityFor(item, activitiesById);
    return Boolean(activity && (activity.requiresBooking || activity.variants[0]?.id));
  }).length;
}

/** The outlet a stop was planned at, else the listing's representative outlet. */
export function tripItemOutletId(item: TripItem, activity: ComputedActivity): string {
  return item.outlet_id ?? activity.outlet.id;
}

/**
 * Earliest open slot when the item has no time of its own, else the open slot
 * starting exactly at that time (Malaysia time) — never a different one, so the
 * customer buys the time they planned.
 */
function pickSlot(slots: BookingSlot[], scheduledTime: string | null): BookingSlot | null {
  const sorted = slots.slice().sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const time = normalizeTripTime(scheduledTime);
  if (!time) return sorted[0] ?? null;
  return sorted.find((slot) => slotClockTime(slot.startsAt) === time) ?? null;
}

/**
 * Resolves a trip's scheduled itinerary into real cart lines. Free/self-guided
 * places (no vendor behind them) are silently skipped — there was never
 * anything to buy. A vendor item that requires booking is only ever matched
 * against a real, currently-open `booking_slots` row for that exact day; when
 * none exists it is reported via `needsSlot` rather than added with a
 * fabricated or shifted slot.
 */
export function resolveTripCheckoutLines(
  scheduledItems: TripItem[],
  activitiesById: Map<string, ComputedActivity>,
  slotsByActivityId: Map<string, BookingSlot[]>,
): TripCheckoutResolution {
  const lines: TripCheckoutLine[] = [];
  const needsSlot: TripCheckoutSkip[] = [];
  const unavailable: TripCheckoutSkip[] = [];

  for (const item of scheduledItems) {
    const activity = vendorActivityFor(item, activitiesById);
    if (!activity) continue;
    const variantId = activity.variants[0]?.id ?? "";
    const outletId = tripItemOutletId(item, activity);

    if (activity.requiresBooking) {
      const outletSlots = (slotsByActivityId.get(activity.id) ?? []).filter((slot) => slot.outletId === outletId);
      const dateGroups = groupBookableBookingSlotsByDate(outletSlots);
      const dayGroup = item.scheduled_date ? dateGroups.find((group) => group.key === item.scheduled_date) : undefined;
      const slot = dayGroup ? pickSlot(dayGroup.slots, item.scheduled_time) : null;
      if (!slot) {
        needsSlot.push({ itemId: item.id, label: item.label });
        continue;
      }
      lines.push({ activityId: activity.id, variantId, outletId, slotId: slot.id, qty: 1 });
      continue;
    }

    // No booking slot to fall back on here — a variant is the only possible
    // backing record, so a variant-less non-booking product really is
    // uncartable (matches activity-detail-client.tsx's "cartUnavailable" state).
    if (!variantId || getSelectedOutletStock(activity, outletId) === 0) {
      unavailable.push({ itemId: item.id, label: item.label });
      continue;
    }
    lines.push({ activityId: activity.id, variantId, outletId, qty: 1 });
  }

  return { lines, needsSlot, unavailable };
}
