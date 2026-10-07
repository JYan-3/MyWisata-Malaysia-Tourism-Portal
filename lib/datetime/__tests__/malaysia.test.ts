import { describe, expect, it } from "vitest";

import {
  isInvalidDateTimeRange,
  isInvalidMalaysiaDateRange,
  isMalaysiaFullDayRange,
  malaysiaCalendarDateToIso,
  malaysiaDateTimeLocalToIso,
} from "@/lib/datetime/malaysia";

describe("Malaysia date-time helpers", () => {
  it("converts Malaysia wall time to a timezone-independent ISO timestamp", () => {
    expect(malaysiaDateTimeLocalToIso("2026-09-18T11:25")).toBe("2026-09-18T03:25:00.000Z");
    expect(malaysiaDateTimeLocalToIso("2026-09-18T11:25:30")).toBe("2026-09-18T03:25:30.000Z");
  });

  it("rejects malformed and impossible local date-time values", () => {
    expect(() => malaysiaDateTimeLocalToIso("not-a-date")).toThrow(RangeError);
    expect(() => malaysiaDateTimeLocalToIso("2026-02-30T11:25")).toThrow(RangeError);
  });

  it("marks only complete equal or reversed ranges as invalid", () => {
    expect(isInvalidDateTimeRange("2026-09-18T11:25", "")).toBe(false);
    expect(isInvalidDateTimeRange("2026-09-18T11:25", "2026-09-18T11:25")).toBe(true);
    expect(isInvalidDateTimeRange("2026-09-18T11:25", "2026-09-18T11:24")).toBe(true);
    expect(isInvalidDateTimeRange("2026-09-18T11:25", "2026-09-18T11:26")).toBe(false);
  });

  it("covers the first and last Malaysia calendar days inclusively", () => {
    const start = malaysiaCalendarDateToIso("2026-10-01", "start");
    const end = malaysiaCalendarDateToIso("2026-10-08", "end");
    expect(start).toBe("2026-09-30T16:00:00.000Z");
    expect(end).toBe("2026-10-08T15:59:59.999Z");
    expect(isInvalidMalaysiaDateRange("2026-10-01", "2026-10-01")).toBe(false);
    expect(isInvalidMalaysiaDateRange("2026-10-08", "2026-10-01")).toBe(true);
    expect(isMalaysiaFullDayRange(start, end)).toBe(true);
    expect(isMalaysiaFullDayRange("2026-09-30T16:00:00+00:00", "2026-10-08T15:59:59.999+00:00")).toBe(true);
    expect(isMalaysiaFullDayRange("2026-10-01T04:12:00.000Z", end)).toBe(false);
  });

  it("rejects invalid date-only values", () => {
    expect(() => malaysiaCalendarDateToIso("2026-02-30", "start")).toThrow(RangeError);
    expect(() => malaysiaCalendarDateToIso("2026-10-01T04:12", "end")).toThrow(RangeError);
    expect(isInvalidMalaysiaDateRange("2026-02-30", "2026-10-08")).toBe(true);
  });
});
