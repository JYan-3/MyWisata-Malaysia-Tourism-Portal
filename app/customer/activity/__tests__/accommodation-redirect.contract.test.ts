import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(resolve(process.cwd(), "app/customer/activity/[id]/page.tsx"), "utf8");

describe("room product pages", () => {
  it("send a room to its hotel page before anything renders", () => {
    const redirectAt = page.indexOf('activity?.categorySlug === "accommodation"');
    expect(redirectAt).toBeGreaterThan(-1);
    expect(page).toMatch(/redirect\(getOutletShopHref\(requestedOutletId \?\? activity\.outletId\)\)/);
    expect(redirectAt).toBeLessThan(page.indexOf("<ActivityDetailClient"));
  });

  it("never lists rooms under 'more from this outlet' on food or activity pages", () => {
    expect(page).toMatch(/relatedProducts\s*=\s*\(\s*isVendorSource[\s\S]*?\)\.filter\(\(related\) => related\.categorySlug !== "accommodation"\)/);
  });
});
