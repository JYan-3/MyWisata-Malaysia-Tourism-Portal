import type { BookingSlot, ComputedActivity, OperatingHours } from "@/backend/core/types";
import { getBookingSlotAvailability, groupBookingSlotsByDate } from "@/lib/customer/booking-slot-presenter";
import { getMalaysiaTodayKey, isOperatingHoursAtAvailable } from "@/lib/customer/operating-hours";
import type { TripItemTimeBounds } from "@/lib/customer/trip-planner";

/**
 * Which times a trip stop may be planned at. Bookable activities use the
 * outlet's real booking slots for that day; food, retail and other listings use
 * the outlet's opening hours in 30-minute steps; accommodation has no time.
 * Plan: Docs/plans/2026-10-14-0055-trip-time-slots-and-outlet.md
 */
export type TripTimeOption = {
  value: string; // HH:MM, Malaysia time
  /** Bookable on its own merits (open slot / outlet open); `disabled` also covers itinerary order. */
  available: boolean;
  disabled: boolean;
  full?: boolean;
  seatsLeft?: number;
};

export type TripTimeChoices =
  | { kind: "free" }      // not a vendor listing (start point, typed place) — the caller decides this
  | { kind: "none" }      // accommodation: date only
  | { kind: "needsDay" }  // pick a day first
  | { kind: "loading" }   // slots or outlet hours not loaded yet
  | { kind: "slots" | "hours"; options: TripTimeOption[] }; // empty options: not available / closed that day

export type TripTimeProblem = "full" | "noSlot" | "closed" | "outsideHours" | "orderConflict";

const STEP_MINUTES = 30;
const MALAYSIA_CLOCK = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kuala_Lumpur", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** "14:00:00" (Postgres TIME) or "14:00" → "14:00". */
export function normalizeTripTime(time: string | null | undefined): string | null {
  return time ? time.slice(0, 5) : null;
}

export function slotClockTime(startsAt: string): string {
  return MALAYSIA_CLOCK.format(new Date(startsAt));
}

function weekdayOf(date: string) {
  return getMalaysiaTodayKey(new Date(`${date}T12:00:00+08:00`));
}

function minutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

function outsideBounds(time: string, bounds: TripItemTimeBounds): boolean {
  if (bounds.disabled) return true;
  return (bounds.min !== undefined && minutes(time) < minutes(bounds.min))
    || (bounds.max !== undefined && minutes(time) > minutes(bounds.max));
}

/** The outlet's slots on `date` (Malaysia day), one option per start time, earliest first. */
export function getDaySlots(slots: BookingSlot[], outletId: string, date: string): BookingSlot[] {
  const outletSlots = slots.filter((slot) => slot.outletId === outletId);
  return (groupBookingSlotsByDate(outletSlots).find((group) => group.key === date)?.slots ?? [])
    .slice()
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export function getTripTimeChoices(input: {
  activity: ComputedActivity | undefined;
  date: string | null;
  outletId: string;
  slots: BookingSlot[] | undefined;
  hours: OperatingHours | null | undefined;
  bounds?: TripItemTimeBounds;
  now?: Date;
}): TripTimeChoices {
  const { activity, date, outletId, slots, hours, bounds = {}, now = new Date() } = input;
  if (!activity) return { kind: "loading" };
  if (activity.categorySlug === "accommodation") return { kind: "none" };
  if (!date) return { kind: "needsDay" };

  if (activity.requiresBooking) {
    if (!slots) return { kind: "loading" };
    const seen = new Set<string>();
    const options: TripTimeOption[] = [];
    for (const slot of getDaySlots(slots, outletId, date)) {
      const value = slotClockTime(slot.startsAt);
      if (seen.has(value)) continue;
      seen.add(value);
      const availability = getBookingSlotAvailability(slot, now);
      const available = availability === "available";
      options.push({
        value,
        available,
        full: availability === "full",
        seatsLeft: Math.max(0, slot.capacity - slot.booked),
        disabled: !available || outsideBounds(value, bounds),
      });
    }
    return { kind: "slots", options };
  }

  if (hours === undefined) return { kind: "loading" };
  const day = weekdayOf(date);
  const options: TripTimeOption[] = [];
  for (let minute = 0; minute < 24 * 60; minute += STEP_MINUTES) {
    const value = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
    if (isOperatingHoursAtAvailable(value, hours, [day])) options.push({ value, available: true, disabled: outsideBounds(value, bounds) });
  }
  return { kind: "hours", options };
}

/** Why a stored time no longer fits the stop's choices, or null when it is fine. */
export function getTripTimeProblem(choices: TripTimeChoices, time: string | null | undefined, hours?: OperatingHours | null, date?: string | null, bounds: TripItemTimeBounds = {}): TripTimeProblem | null {
  const value = normalizeTripTime(time);
  if (!value) return null;
  if (choices.kind === "slots") {
    const option = choices.options.find((entry) => entry.value === value);
    if (option?.full) return "full";
    return option?.available ? (option.disabled ? "orderConflict" : null) : "noSlot";
  }
  if (choices.kind === "hours") {
    if (choices.options.length === 0) return "closed";
    const option = choices.options.find(entry => entry.value === value);
    if (option?.available && option.disabled) return "orderConflict";
    // Typed times between steps must still respect the complete itinerary bounds.
    if (!date || !isOperatingHoursAtAvailable(value, hours ?? null, [weekdayOf(date)])) return "outsideHours";
    return outsideBounds(value,bounds) ? "orderConflict" : null;
  }
  return null;
}
