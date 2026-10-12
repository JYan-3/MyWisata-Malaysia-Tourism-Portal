import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CUSTOMER_FOOTER_GROUPS, customerFooterVariant } from "@/lib/customer/footer-navigation";

const locales = Object.fromEntries(
  (["en", "ms", "zh-CN"] as const).map((locale) => [
    locale,
    JSON.parse(readFileSync(resolve(process.cwd(), `app/i18n/locales/${locale}/customer.json`), "utf8")) as Record<string, unknown>,
  ]),
);

function lookup(resource: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((value, part) => (value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined), resource);
}

describe("customer site footer", () => {
  it("is hidden on the trip planner, slim while paying, and full everywhere else", () => {
    expect(customerFooterVariant("/customer/trip/0bfcf30c-ae70-46e0-9f48-4cc98c231b5b")).toBe("none");
    expect(customerFooterVariant("/customer/trip")).toBe("full");
    expect(customerFooterVariant("/customer/cart")).toBe("slim");
    expect(customerFooterVariant("/customer/checkout")).toBe("slim");
    expect(customerFooterVariant("/customer/checkout/success")).toBe("slim");
    expect(customerFooterVariant("/customer/cartography")).toBe("full");
    for (const path of ["/customer", "/customer/explore", "/customer/orders", "/customer/vendor/abc", "/help", "/legal/privacy"]) {
      expect(customerFooterVariant(path), path).toBe("full");
    }
  });

  it("only links to pages that exist", () => {
    for (const { href } of CUSTOMER_FOOTER_GROUPS.flatMap((group) => group.links)) {
      expect(existsSync(resolve(process.cwd(), `app${href === "/" ? "" : href}/page.tsx`)), href).toBe(true);
    }
  });

  it("has every heading and link label in English, Malay and Chinese", () => {
    const keys = CUSTOMER_FOOTER_GROUPS.flatMap((group) => [group.titleKey, ...group.links.map((link) => link.labelKey)]);
    for (const [locale, resource] of Object.entries(locales)) {
      for (const key of [...keys, "footer.ariaLabel"]) {
        expect(lookup(resource, key), `${locale}:${key}`).toEqual(expect.any(String));
      }
    }
  });
});
