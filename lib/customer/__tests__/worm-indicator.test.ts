import { describe, expect, it } from "vitest";
import { wormIndicatorGeometry } from "@/lib/customer/worm-indicator";

const sizes = { dot: 16, pill: 58, gap: 13 };

describe("wormIndicatorGeometry", () => {
  it("expands the active dot at the first page", () => {
    expect(wormIndicatorGeometry(0, 4, sizes)).toEqual({
      widths: [58, 16, 16, 16],
      pillLeft: 0,
      pillWidth: 58,
    });
  });

  it("stretches between adjacent pages", () => {
    expect(wormIndicatorGeometry(0.5, 4, sizes)).toEqual({
      widths: [37, 37, 16, 16],
      pillLeft: 0,
      pillWidth: 87,
    });
  });

  it("moves the pill to the second page", () => {
    expect(wormIndicatorGeometry(1, 4, sizes)).toEqual({
      widths: [16, 58, 16, 16],
      pillLeft: 29,
      pillWidth: 58,
    });
  });

  it("clamps progress at the first and last pages", () => {
    expect(wormIndicatorGeometry(-1, 4, sizes)).toEqual(wormIndicatorGeometry(0, 4, sizes));
    expect(wormIndicatorGeometry(9, 4, sizes)).toEqual({
      widths: [16, 16, 16, 58],
      pillLeft: 87,
      pillWidth: 58,
    });
  });

  it("works with one page", () => {
    expect(wormIndicatorGeometry(0, 1, sizes)).toEqual({
      widths: [58],
      pillLeft: 0,
      pillWidth: 58,
    });
  });
});
