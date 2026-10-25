import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const layoutSource = readFileSync(resolve(process.cwd(), "app/customer/layout.tsx"), "utf8");
const headerNavigationSource = readFileSync(resolve(process.cwd(), "lib/customer/header-navigation.ts"), "utf8");
const mobileRowStart = layoutSource.indexOf("{/* Mobile bottom-ish secondary row for the rest of nav */}");
const mobileRow = layoutSource.slice(mobileRowStart, layoutSource.indexOf("</nav>", mobileRowStart));

describe("customer mobile navigation", () => {
  it("does not duplicate My Vouchers outside the account menu", () => {
    expect(mobileRowStart).toBeGreaterThanOrEqual(0);
    expect(mobileRow).not.toContain('href="/customer/vouchers"');
    expect(headerNavigationSource).toContain('href: "/customer/vouchers"');
  });
});
