import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BackLink, shouldGoBack } from "../back-link";

describe("back link", () => {
  it("goes back when the tab has a previous page", () => {
    expect(shouldGoBack({ historyLength: 3, referrer: "", origin: "https://app.test" })).toBe(true);
  });

  it("uses the fallback when the page was opened in a fresh tab", () => {
    expect(shouldGoBack({ historyLength: 1, referrer: "", origin: "https://app.test" })).toBe(false);
  });

  it("can refuse to go back to another site, e.g. a payment provider", () => {
    const external = { historyLength: 4, referrer: "https://checkout.stripe.com/pay", origin: "https://app.test", sameOriginOnly: true };
    expect(shouldGoBack(external)).toBe(false);
    expect(shouldGoBack({ ...external, referrer: "https://app.test/customer/cart" })).toBe(true);
    expect(shouldGoBack({ ...external, sameOriginOnly: false })).toBe(true);
  });

  it("renders a real link to the fallback with the given classes", () => {
    const markup = renderToStaticMarkup(<BackLink fallbackHref="/customer/orders" className="text-primary" aria-label="Back">Back</BackLink>);
    expect(markup).toMatch(/<a[^>]*href="\/customer\/orders"/);
    expect(markup).toContain('class="text-primary"');
    expect(markup).toContain('aria-label="Back"');
  });
});
