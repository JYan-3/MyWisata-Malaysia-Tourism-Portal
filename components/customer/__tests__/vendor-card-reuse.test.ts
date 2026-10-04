import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sharedCardSource = readFileSync(
  resolve(process.cwd(), "components/customer/vendor-card.tsx"),
  "utf8",
);
const homeSource = readFileSync(
  resolve(process.cwd(), "app/customer/customer-home-client.tsx"),
  "utf8",
);
const partnersSource = readFileSync(
  resolve(process.cwd(), "app/customer/search/search-client.tsx"),
  "utf8",
);

describe("customer vendor card reuse", () => {
  it("uses one shared vendor card in Home and Partners", () => {
    expect(homeSource).toContain('from "@/components/customer/vendor-card"');
    expect(partnersSource).toContain('from "@/components/customer/vendor-card"');
    expect(homeSource).toContain("<VendorCard");
    expect(partnersSource).toContain("<VendorCard");
    expect(partnersSource).not.toContain("function VendorDirectoryCard");
  });

  it("uses the verified partner badge consistently and keeps featured ranking separate", () => {
    expect(sharedCardSource).toContain("isFeatured?: boolean");
    expect(sharedCardSource).toContain('t("ui.search.verifiedLocalPartner")');
    expect(sharedCardSource).toContain('t("ui.search.featuredPartner")');
    expect(partnersSource).toContain("featuredVendorIds");
    expect(partnersSource).toContain("rankPartnerDirectory");
    expect(partnersSource).toContain("isFeatured={featuredVendorIds.has(vendor.id)}");
  });

  it("reveals Partners vendor details on interaction using the shared card", () => {
    expect(partnersSource).toContain("detailsRevealOnHover");
    const detailsStart = sharedCardSource.indexOf('<div id={detailsId}');
    const detailsEnd = sharedCardSource.indexOf("</div>", detailsStart);
    const detailsPanel = sharedCardSource.slice(detailsStart, detailsEnd);
    expect(detailsPanel).toContain("MapPin");
    expect(detailsPanel).toContain("{location}");
  });

  it("uses the same compact caption hover and keeps Explore vendor available on both pages", () => {
    expect(homeSource).toContain('detailsRevealStyle="caption"');
    expect(partnersSource).toContain('detailsRevealStyle="caption"');
    expect(sharedCardSource).toContain('detailsRevealStyle?: "panel" | "caption"');
    expect(sharedCardSource).toContain('detailsRevealStyle = "panel"');
    expect(sharedCardSource).toContain("<CardMediaHoverCaption>");
    expect(sharedCardSource).toContain("mw-card-body-compact");
    expect(sharedCardSource).toContain('{showExploreAction && <Link');
    const captionStart = sharedCardSource.indexOf("<CardMediaHoverCaption>");
    const captionEnd = sharedCardSource.indexOf("</CardMediaHoverCaption>", captionStart);
    const caption = sharedCardSource.slice(captionStart, captionEnd);
    expect(caption).toContain("{location}");
    expect(caption).toContain("{showExploreAction && <Link");
    expect(caption).toContain("group-hover:pointer-events-auto");
    expect(homeSource).not.toContain("showExploreAction={false}");
    expect(partnersSource).not.toContain("showExploreAction={false}");
  });

  it("can show a nearby distance in the same caption as the outlet area", () => {
    const captionStart = sharedCardSource.indexOf("<CardMediaHoverCaption>");
    const captionEnd = sharedCardSource.indexOf("</CardMediaHoverCaption>", captionStart);
    const caption = sharedCardSource.slice(captionStart, captionEnd);
    expect(sharedCardSource).toContain("distanceLabel?: string");
    expect(caption).toContain("distanceLabel");
  });
});
