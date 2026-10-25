import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HomeDestinationWormIndicator } from "@/components/customer/home-destination-worm-indicator";

describe("HomeDestinationWormIndicator", () => {
  it("renders accessible page controls with the active worm position", () => {
    const markup = renderToStaticMarkup(
      <HomeDestinationWormIndicator
        count={4}
        progress={1}
        current={1}
        sizes={{ dot: 16, pill: 58, gap: 13 }}
        label="Destination carousel controls"
        pageLabel={(page, count) => `Page ${page} of ${count}`}
        onSelect={vi.fn()}
      />,
    );

    expect(markup).toContain('role="group"');
    expect(markup).toContain('aria-label="Destination carousel controls"');
    expect(markup.match(/<button/g)).toHaveLength(4);
    expect(markup).toContain('aria-label="Page 2 of 4"');
    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain("width:16px;height:16px");
    expect(markup).toContain("width:58px;height:16px");
    expect(markup).toContain('left:29px;width:58px');
    expect(markup).not.toContain("justify-center");
  });
});
