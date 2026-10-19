import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";

async function headerMap() {
  const rules = await nextConfig.headers!();
  const all = rules.find((rule) => rule.source === "/(.*)");
  return new Map((all?.headers ?? []).map((header) => [header.key, header.value]));
}

describe("security headers", () => {
  it("sends the baseline security headers on every route", async () => {
    const headers = await headerMap();
    expect(headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headers.get("Strict-Transport-Security")).toContain("max-age=63072000");
    expect(headers.get("Permissions-Policy")).toContain("microphone=()");
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it("blocks framing by other sites, plugins, base hijacking and unknown script origins", async () => {
    const csp = (await headerMap()).get("Content-Security-Policy") ?? "";
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toMatch(/script-src 'self' 'unsafe-inline'[^;]*https:\/\/maps\.googleapis\.com/);
    expect(csp).not.toMatch(/script-src[^;]*\s(\*|https:)(\s|;|$)/);
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toMatch(/script-src[^;]*https:\/\/challenges\.cloudflare\.com/);
    expect(csp).toContain("frame-src 'self' https://challenges.cloudflare.com");
  });
});
