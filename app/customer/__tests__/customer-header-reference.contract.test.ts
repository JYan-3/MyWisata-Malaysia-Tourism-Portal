import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const customerLayoutSource = readFileSync(
  resolve(process.cwd(), "app/customer/layout.tsx"),
  "utf8",
);
const logoSource = readFileSync(
  resolve(process.cwd(), "components/shared/mylawatan-logo.tsx"),
  "utf8",
);

describe("customer header reference contract", () => {
  it("keeps the compact header composition from the latest commit", () => {
    expect(customerLayoutSource).not.toContain('data-customer-header="true"');
    expect(customerLayoutSource).toContain("h-16");
    expect(customerLayoutSource).toContain("max-w-7xl mx-auto");
    expect(customerLayoutSource).toContain("text-sm font-medium");
    expect(customerLayoutSource).toContain("ml-auto flex shrink-0");
    expect(customerLayoutSource).not.toContain("h-[104px]");
    expect(customerLayoutSource).not.toContain("markSize={56}");
  });

  it("keeps the shared Customer header fixed at the top while routes scroll", () => {
    expect(customerLayoutSource).toMatch(/<nav className="sticky top-0 z-40\b/);
  });

  it("uses the supplied logo asset without changing the header row geometry", () => {
    expect(customerLayoutSource).toContain('src="/branding/mylawatan-logo-transparent.png?v=2"');
    expect(customerLayoutSource).toContain("width={758}");
    expect(customerLayoutSource).toContain("height={306}");
    expect(customerLayoutSource).toContain("h-16");
  });

  it("keeps the logo as one shared, non-shifting lockup", () => {
    expect(logoSource).toContain('data-brand-logo="mylawatan"');
    expect(logoSource).toContain('aria-label={LOGO_BRAND_NAME}');
    expect(logoSource).toContain("gap-4");
  });

  it("closes the header content wrapper before the mobile navigation row", () => {
    expect(customerLayoutSource).toContain(
      "        </div>\n\n        {/* Mobile bottom-ish secondary row",
    );
  });

  it("keeps the latest commit utility visibility rules", () => {
    expect(customerLayoutSource).toContain('className="hidden md:flex w-28"');
    expect(customerLayoutSource).not.toContain('className="hidden md:block"');
    expect(customerLayoutSource).not.toContain("max-md:hidden");
  });

  it("keeps Saved in mobile navigation without a desktop utility shortcut", () => {
    expect(customerLayoutSource.match(/href="\/customer\/saved"/g) ?? []).toHaveLength(1);
    expect(customerLayoutSource).toContain('import { ArrowRightLeft, Bell, Bookmark, ChevronDown, ShoppingCart, Store, Tag } from "lucide-react"');
    expect(customerLayoutSource).toContain('<Bookmark size={13} aria-hidden="true" fill={savedCount > 0 ? "currentColor" : "none"} />');

    const utilityRowStart = customerLayoutSource.indexOf('className="ml-auto flex shrink-0 items-center gap-0 sm:gap-1"');
    const cartLinkStart = customerLayoutSource.indexOf('href="/customer/cart"', utilityRowStart);
    const desktopUtilities = customerLayoutSource.slice(utilityRowStart, cartLinkStart);
    expect(desktopUtilities).not.toContain('href="/customer/saved"');
    expect(desktopUtilities).not.toContain("<Bookmark");
  });

  it("compresses the customer utility row at phone widths to keep account controls visible", () => {
    expect(customerLayoutSource).toContain("px-2 sm:px-6 flex items-center gap-1 sm:gap-8");
    expect(customerLayoutSource).toContain("w-[62px] min-[360px]:w-[84px] min-[420px]:w-[94px] sm:w-[118px]");
    expect(customerLayoutSource).toContain("className=\"w-14 min-[360px]:w-16 min-[420px]:w-20 md:w-24\"");
    expect(customerLayoutSource).toContain("text-muted-foreground transition-transform sm:inline");
  });

  it("wraps account-menu descriptions instead of clipping them with an ellipsis", () => {
    expect(customerLayoutSource).toContain(
      '<span className="block whitespace-normal break-words text-[0.6875rem] leading-5 text-muted-foreground">{tCustomer(`${item.labelKey}.description`)}</span>',
    );
  });
});
