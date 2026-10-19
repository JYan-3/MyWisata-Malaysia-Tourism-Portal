import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "app/customer/trip/[tripId]/trip-planner-client.tsx"), "utf8");

describe("trip planner accommodation checkout", () => {
  it("does not partially add accommodation lines that require guest details from the hotel page", () => {
    expect(source).toContain('categorySlug === "accommodation"');
    expect(source).toContain('ui.tripCheckout.stayMustBeBookedFromHotelPage');
    expect(source).toContain("for (const line of purchasableLines)");
  });
});
