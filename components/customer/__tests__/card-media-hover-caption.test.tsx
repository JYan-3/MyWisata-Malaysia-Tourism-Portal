import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CardMediaHoverCaption } from "@/components/customer/card-media-hover-caption";

describe("CardMediaHoverCaption", () => {
  it("reveals caller-provided media details on hover and keyboard focus", () => {
    const markup = renderToStaticMarkup(
      <div className="group relative">
        <CardMediaHoverCaption>
          <p>George Town · Retail</p>
          <p>09:00–18:00</p>
        </CardMediaHoverCaption>
      </div>,
    );

    expect(markup).toContain("bg-gradient-to-t from-primary/95 via-primary/40 to-transparent");
    expect(markup).toContain("group-hover:opacity-100");
    expect(markup).toContain("group-focus-within:opacity-100");
    expect(markup).toContain("motion-reduce:transition-none");
    expect(markup).toContain("George Town · Retail");
    expect(markup).toContain("09:00–18:00");
  });
});
