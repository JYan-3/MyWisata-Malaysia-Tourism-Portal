import { describe, expect, it } from "vitest";
import { resolveStaySearch, stayNightStartsAt } from "@/lib/customer/outlet-shop";

describe("resolveStaySearch", () => {
  const today = "2026-10-17";
  it("defaults to one night from today", () => {
    expect(resolveStaySearch({}, today)).toEqual({ checkIn: today, checkOut: "2026-10-18", nights: 1, rooms: 1, adults: 1 });
  });
  it("derives nights across a month end and clamps inputs", () => {
    expect(resolveStaySearch({ checkin: "2026-10-30", checkout: "2026-11-02", rooms: "99", adults: "0" }, today)).toMatchObject({ nights: 3, rooms: 10, adults: 1 });
    expect(resolveStaySearch({ checkin: "2026-10-30", checkout: "2027-03-01" }, today).nights).toBe(30);
  });
  it("rejects past, malformed and impossible dates", () => {
    expect(resolveStaySearch({ checkin: "2026-10-01" }, today).checkIn).toBe(today);
    expect(resolveStaySearch({ checkin: "2026-02-31", checkout: "x" }, today)).toMatchObject({ checkIn: today, nights: 1 });
    expect(resolveStaySearch({ checkin: "2026-10-20", checkout: "2026-10-19" }, today).nights).toBe(1);
  });
  it("night slots start at 15:00 Malaysia time", () => {
    expect(stayNightStartsAt("2026-10-20")).toBe("2026-10-20T07:00:00.000Z");
  });
});

import { formatStayRange } from "@/lib/customer/booking-view";
describe("formatStayRange", () => {
  it("spans check-in to check-out in Malaysia time", () => {
    expect(formatStayRange("2026-10-24T07:00:00.000Z", 3)).toMatch(/24 Oct.*27 Oct/);
  });
});
