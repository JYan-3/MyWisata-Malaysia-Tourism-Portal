import { describe, expect, it } from "vitest";
import type { BookingSlot, ComputedActivity, OperatingHours } from "@/backend/core/types";
import { getTripTimeChoices, getTripTimeProblem } from "@/lib/customer/trip-time-options";

const NOW = new Date("2030-01-01T00:00:00+08:00");
const MONDAY = "2030-10-14";
const SUNDAY = "2030-10-13";

function activity(overrides: Partial<ComputedActivity> = {}): ComputedActivity {
  return { id: "p1", categorySlug: "food", requiresBooking: false, outlet: { id: "outlet-1" }, ...overrides } as ComputedActivity;
}

function slot(id: string, startsAt: string, overrides: Partial<BookingSlot> = {}): BookingSlot {
  return { id, activityId: "p1", outletId: "outlet-1", startsAt, capacity: 10, booked: 2, status: "available", ...overrides };
}

const HOURS: OperatingHours = {
  mon: { open: "09:00", close: "16:00", periods: [{ open: "09:00", close: "11:00" }, { open: "14:00", close: "15:00" }] },
  sun: { open: "09:00", close: "18:00", closed: true },
};

describe("getTripTimeChoices", () => {
  it("gives accommodation no time and asks for a day before anything else", () => {
    expect(getTripTimeChoices({ activity: activity({ categorySlug: "accommodation" }), date: MONDAY, outletId: "outlet-1", slots: [], hours: HOURS })).toEqual({ kind: "none" });
    expect(getTripTimeChoices({ activity: activity(), date: null, outletId: "outlet-1", slots: [], hours: HOURS })).toEqual({ kind: "needsDay" });
  });

  it("lists only the planned outlet's slots that day, with full ones disabled", () => {
    const choices = getTripTimeChoices({
      activity: activity({ categorySlug: "activity", requiresBooking: true }),
      date: MONDAY,
      outletId: "outlet-1",
      slots: [
        slot("late", `${MONDAY}T11:00:00+08:00`, { booked: 10, status: "full" }),
        slot("early", `${MONDAY}T09:00:00+08:00`),
        slot("other-outlet", `${MONDAY}T10:00:00+08:00`, { outletId: "outlet-2" }),
        slot("other-day", "2030-10-15T09:00:00+08:00"),
      ],
      hours: HOURS,
      now: NOW,
    });

    expect(choices).toEqual({
      kind: "slots",
      options: [
        { value: "09:00", available: true, full: false, seatsLeft: 8, disabled: false },
        { value: "11:00", available: false, full: true, seatsLeft: 0, disabled: true },
      ],
    });
  });

  it("waits for slots to load instead of saying the activity is unavailable", () => {
    expect(getTripTimeChoices({ activity: activity({ requiresBooking: true }), date: MONDAY, outletId: "outlet-1", slots: undefined, hours: HOURS }))
      .toEqual({ kind: "loading" });
  });

  it("offers 30-minute steps inside each opening period, and nothing on a closed day", () => {
    const monday = getTripTimeChoices({ activity: activity(), date: MONDAY, outletId: "outlet-1", slots: undefined, hours: HOURS });
    expect(monday.kind === "hours" && monday.options.map((option) => option.value)).toEqual(["09:00", "09:30", "10:00", "10:30", "14:00", "14:30"]);

    const sunday = getTripTimeChoices({ activity: activity(), date: SUNDAY, outletId: "outlet-1", slots: undefined, hours: HOURS });
    expect(sunday).toEqual({ kind: "hours", options: [] });
  });

  it("disables times that would break the itinerary order", () => {
    const choices = getTripTimeChoices({ activity: activity(), date: MONDAY, outletId: "outlet-1", slots: undefined, hours: HOURS, bounds: { min: "10:00" } });
    expect(choices.kind === "hours" && choices.options.filter((option) => option.disabled).map((option) => option.value)).toEqual(["09:00", "09:30"]);
  });
});

describe("getTripTimeProblem", () => {
  const slots = [slot("a", `${MONDAY}T09:00:00+08:00`), slot("b", `${MONDAY}T11:00:00+08:00`, { booked: 10 })];
  const slotChoices = getTripTimeChoices({ activity: activity({ requiresBooking: true }), date: MONDAY, outletId: "outlet-1", slots, hours: HOURS, now: NOW });
  const hourChoices = getTripTimeChoices({ activity: activity(), date: MONDAY, outletId: "outlet-1", slots: undefined, hours: HOURS });

  it("flags a full or missing slot, accepting Postgres TIME values", () => {
    expect(getTripTimeProblem(slotChoices, "09:00:00")).toBeNull();
    expect(getTripTimeProblem(slotChoices, "11:00")).toBe("full");
    expect(getTripTimeProblem(slotChoices, "00:26")).toBe("noSlot");
  });

  it("flags times outside opening hours but keeps typed times inside them", () => {
    expect(getTripTimeProblem(hourChoices, "10:15", HOURS, MONDAY)).toBeNull();
    expect(getTripTimeProblem(hourChoices, "12:00", HOURS, MONDAY)).toBe("outsideHours");
    const sunday = getTripTimeChoices({ activity: activity(), date: SUNDAY, outletId: "outlet-1", slots: undefined, hours: HOURS });
    expect(getTripTimeProblem(sunday, "10:00", HOURS, SUNDAY)).toBe("closed");
    expect(getTripTimeProblem(hourChoices, null, HOURS, MONDAY)).toBeNull();
  });
});
