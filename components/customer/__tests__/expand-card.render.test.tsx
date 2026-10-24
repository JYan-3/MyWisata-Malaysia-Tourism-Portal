import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => <a href={href} {...props}>{children}</a> }));

import { ExpandCard } from "@/components/customer/expand-card";

const base = {
  media: <span>Cover media</span>,
  title: <h3>Card title</h3>,
  details: <p>Hidden details</p>,
  detailsId: "card-1-details",
  action: { href: "/x", label: "Go" },
};

describe("ExpandCard", () => {
  it("renders the drawer details and the action inside the CTA drawer", () => {
    const markup = renderToStaticMarkup(<ExpandCard {...base} />);
    const drawer = markup.slice(markup.indexOf("mw-card-cta-drawer"));

    expect(markup).toContain('class="mw-card mw-card-expand-card group"');
    expect(markup).toContain("Card title");
    expect(drawer).toContain('id="card-1-details"');
    expect(drawer).toContain('data-card-details-inline="true"');
    expect(drawer).toContain("Hidden details");
    expect(drawer).toMatch(/<a [^>]*href="\/x"[^>]*data-card-primary-cta="true"[^>]*>Go<\/a>/);
  });

  it("omits the price row when no price is given", () => {
    expect(renderToStaticMarkup(<ExpandCard {...base} />)).not.toContain("mw-card-price-row");

    const priced = renderToStaticMarkup(<ExpandCard {...base} price={<span>RM1</span>} />);
    expect(priced).toContain("mw-card-price-row");
    expect(priced).toContain("RM1");
  });
});
