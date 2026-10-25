import { describe, expect, it } from "vitest";
import { decideTouchPageTurn } from "@/lib/customer/touch-page-turn";

describe("decideTouchPageTurn", () => {
  it("advances exactly one page for a large left swipe", () => {
    expect(decideTouchPageTurn({ startPage: 0, deltaX: -900, thresholdPx: 48, pageCount: 8 })).toBe(1);
    expect(decideTouchPageTurn({ startPage: 3, deltaX: -900, thresholdPx: 48, pageCount: 8 })).toBe(4);
  });

  it("moves back exactly one page for a large right swipe", () => {
    expect(decideTouchPageTurn({ startPage: 4, deltaX: 900, thresholdPx: 48, pageCount: 8 })).toBe(3);
  });

  it("does not turn for a movement below the threshold", () => {
    expect(decideTouchPageTurn({ startPage: 2, deltaX: -47, thresholdPx: 48, pageCount: 8 })).toBe(2);
  });

  it("clamps turns at the first and last page", () => {
    expect(decideTouchPageTurn({ startPage: 0, deltaX: 500, thresholdPx: 48, pageCount: 8 })).toBe(0);
    expect(decideTouchPageTurn({ startPage: 7, deltaX: -500, thresholdPx: 48, pageCount: 8 })).toBe(7);
  });
});
