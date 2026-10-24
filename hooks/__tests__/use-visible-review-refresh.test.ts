import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "hooks/use-visible-review-refresh.ts"), "utf8");

describe("visible review refresh contract", () => {
  it("pauses hidden pages and refreshes when the page becomes visible or focused", () => {
    expect(source).toContain('document.addEventListener("visibilitychange", onVisibilityChange)');
    expect(source).toContain('window.addEventListener("focus", onFocus)');
    expect(source).toContain("if (!isVisible())");
    expect(source).toContain("void runRefresh()");
  });

  it("serializes requests, aborts them after a timeout, and backs off failures", () => {
    expect(source).toContain("if (!isMounted || !isVisible() || inFlight || accessDenied) return");
    expect(source).toContain("REQUEST_TIMEOUT_MS = 15_000");
    expect(source).toContain("MAX_INTERVAL_MS = 120_000");
    expect(source).toContain("activeController.abort()");
    expect(source).toContain("intervalMs * (2 ** failureCount)");
  });

  it("removes listeners and timers on unmount", () => {
    expect(source).toContain("document.removeEventListener(\"visibilitychange\", onVisibilityChange)");
    expect(source).toContain("window.removeEventListener(\"focus\", onFocus)");
    expect(source).toContain("controller?.abort()");
  });
});
