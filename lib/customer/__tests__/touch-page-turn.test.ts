import { describe, expect, it } from "vitest";
import { limitSwipeToOnePage } from "@/lib/customer/touch-page-turn";

describe("limitSwipeToOnePage", () => {
  it("pulls a fling that overshot forward back to the next page", () => {
    expect(limitSwipeToOnePage({ startPage: 1, settledPage: 3, pageCount: 8 })).toBe(2);
    expect(limitSwipeToOnePage({ startPage: 0, settledPage: 7, pageCount: 8 })).toBe(1);
  });

  it("pulls a fling that overshot backward back to the previous page", () => {
    expect(limitSwipeToOnePage({ startPage: 5, settledPage: 2, pageCount: 8 })).toBe(4);
  });

  it("keeps a swipe that already moved one page or stayed put", () => {
    expect(limitSwipeToOnePage({ startPage: 1, settledPage: 2, pageCount: 8 })).toBe(2);
    expect(limitSwipeToOnePage({ startPage: 3, settledPage: 3, pageCount: 8 })).toBe(3);
    expect(limitSwipeToOnePage({ startPage: 4, settledPage: 3, pageCount: 8 })).toBe(3);
  });

  it("stays inside the first and last page", () => {
    expect(limitSwipeToOnePage({ startPage: 0, settledPage: -2, pageCount: 8 })).toBe(0);
    expect(limitSwipeToOnePage({ startPage: 7, settledPage: 9, pageCount: 8 })).toBe(7);
  });
});
