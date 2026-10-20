import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(
  resolve(process.cwd(), "app/customer/destination/[destinationId]/page.tsx"),
  "utf8",
);

describe("destination localized content server boundary", () => {
  it("uses a serializable localized heading adapter for product card titles", () => {
    expect(pageSource).toContain("<LocalizedContentHeading");
    expect(pageSource).toContain("from \"@/components/customer/localized-content\"");
    expect(pageSource).not.toContain("{({ text, control }) =>");
  });
});
