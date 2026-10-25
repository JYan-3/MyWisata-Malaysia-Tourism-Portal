import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const hook = readFileSync(resolve(process.cwd(), "components/customer/use-home-destination-pager.ts"), "utf8");

describe("home destination pager hook", () => {
  it("reads the wheel's starting page from the live scroll position unless a page turn is still animating", () => {
    const sync = hook.slice(hook.indexOf("const sync = useCallback"), hook.indexOf("const goToPage = useCallback"));
    // sync() runs on every scroll; it must not pin pendingPageRef, or wheel turns after a touch/trackpad scroll start from a stale page.
    expect(sync).not.toContain("pendingPageRef.current =");
    expect(hook).toContain("pendingPageRef.current ?? Math.round(viewport.scrollLeft / metricsRef.current.pageStep)");
  });
});
