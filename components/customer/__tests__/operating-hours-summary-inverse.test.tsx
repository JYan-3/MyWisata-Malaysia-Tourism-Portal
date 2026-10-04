import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import { OperatingHoursSummary } from "@/components/customer/operating-hours-summary";

describe("operating hours in a dark detail panel", () => {
  it("uses light text and borders when the inverse compact variant is enabled", () => {
    const markup = renderToStaticMarkup(
      <OperatingHoursSummary hours={{ mon: { open: "09:00", close: "18:00" } }} currentlyOpen inverse compact />,
    );

    expect(markup).toContain("text-white/85");
    expect(markup).toContain("text-white");
    expect(markup).toContain("text-emerald-300");
    expect(markup).toContain("border-white/20");
    expect(markup).toContain("text-white/75");
  });
});
