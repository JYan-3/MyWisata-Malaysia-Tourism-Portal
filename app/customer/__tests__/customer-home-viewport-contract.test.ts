import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const homeSource = readFileSync(
  resolve(process.cwd(), "app/customer/customer-home-client.tsx"),
  "utf8",
);
const homePageSource = readFileSync(
  resolve(process.cwd(), "app/customer/page.tsx"),
  "utf8",
);
const activityCardSource = readFileSync(
  resolve(process.cwd(), "components/customer/activity-card.tsx"),
  "utf8",
);
const vendorCardSource = readFileSync(
  resolve(process.cwd(), "components/customer/vendor-card.tsx"),
  "utf8",
);

describe("customer home first viewport", () => {
  it("lets the desktop hero hug its content and aligns the postcard with the headline", () => {
    expect(homeSource).toContain("lg:h-auto");
    expect(homeSource).toContain("lg:min-h-0");
    expect(homeSource).toContain("lg:flex");
    expect(homeSource).toContain("lg:flex-col");
    expect(homeSource).toContain("grid items-start gap-8");
    expect(homeSource).toContain("aspect-[0.78] w-full max-w-[460px] md:aspect-auto");
  });

  it("keeps the Explore Destinations carousel inside that desktop budget", () => {
    expect(homeSource).toContain("lg:flex-none");
    expect(homeSource).toContain("lg:min-h-[500px]");
    expect(homeSource).toContain("lg:h-[500px]");
    expect(homeSource).toContain("lg:h-[380px]");
    expect(homeSource).toContain("lg:max-w-[560px]");
    expect(homeSource).toContain("lg:w-[88%]");
    expect(homeSource).toContain("lg:h-full lg:aspect-auto");
    expect(homeSource).toContain("lg:mt-8");
    expect(homeSource).toContain("lg:pt-6");
    expect(homeSource).toContain("lg:h-44");
    expect(homeSource).toContain('aria-label={t("ui.home.destinationCarousel")');
  });

  it("exposes keyboard-accessible controls beside View all for the destination rail", () => {
    expect(homeSource).toContain("ChevronLeft");
    expect(homeSource).toContain("ChevronRight");
    expect(homeSource).toContain('aria-label={t("ui.map.previous")');
    expect(homeSource).toContain('aria-label={t("ui.map.next")');
    expect(homeSource).toContain("destinationRailRef");
    expect(homeSource).toContain('behavior: "smooth"');
  });

  it("keeps the homepage discovery shelf under the Featured Highlights label", () => {
    expect(homeSource).toContain("const highlightItems = popular.slice(0, 4)");
    expect(homeSource).toContain("recommended.filter((activity) => !highlightIds.has(activity.id)).slice(0, 4)");
    expect(homeSource).toContain('t("ui.home.featuredHighlights")');
    expect(homeSource).toContain('t("ui.home.forYou")');
    expect(homeSource).toContain("!isGuest && forYouItems.length > 0");
    expect(homeSource).not.toContain('t("ui.home.popularExperiences")');
    expect(homeSource).not.toContain('t("ui.home.localDelicacies")');
    expect(homeSource).toContain('t("ui.actions.viewAll")');
  });

  it("orders For You below Highlights, then Event, Nearby, and Featured Partners", () => {
    const highlightsIndex = homeSource.indexOf('t("ui.home.featuredHighlights")');
    const forYouIndex = homeSource.indexOf('t("ui.home.forYou")');
    const eventPartnersIndex = homeSource.indexOf('<EventPartnersSection');
    const nearbyPartnersIndex = homeSource.indexOf('t("ui.home.nearbyPartners")');
    const featuredPartnersIndex = homeSource.indexOf('t("ui.home.featuredPartners")');

    expect(highlightsIndex).toBeGreaterThanOrEqual(0);
    expect(forYouIndex).toBeGreaterThan(highlightsIndex);
    expect(eventPartnersIndex).toBeGreaterThan(forYouIndex);
    expect(nearbyPartnersIndex).toBeGreaterThan(eventPartnersIndex);
    expect(featuredPartnersIndex).toBeGreaterThan(nearbyPartnersIndex);
    expect(homeSource).toContain("eventPartners.slice(0, 4)");
    expect(homeSource).toContain("vendors.slice(0, 4)");
    expect(homeSource).toContain("highlightItems.map((activity)");
    expect(homeSource).toContain("forYouItems.map((activity)");
    expect(homePageSource).toContain("campaign.vendors.map((vendor) => vendor.vendorId)");
    expect(homePageSource).toContain("eventVendorIds");
    expect(homePageSource).toContain('.in("id", eventVendorIds)');
    expect(homePageSource).toContain("nextVendorEvent");
  });

  it("only requests device location after the nearby-partner action and caps results at four", () => {
    expect(homeSource).toContain('fetch("/api/customer/nearby-partners"');
    expect(homeSource).toContain("navigator.geolocation.getCurrentPosition");
    expect(homeSource).toContain("nearbyPartners.slice(0, 4)");
    expect(homeSource).toContain('href="/customer/partners"');
    expect(homeSource).toContain('detailsRevealStyle="caption"');
  });

  it("supports detail reveal on home product and partner cards", () => {
    expect(homeSource).toContain("detailsRevealOnHover");
    expect(activityCardSource).toContain("detailsRevealOnHover");
    expect(activityCardSource).toContain("group-hover:flex");
    expect(activityCardSource).toContain("group-focus-within:flex");
    expect(activityCardSource).toContain("mw-card-body-compact");
    expect(activityCardSource).toContain('inverse');
    expect(activityCardSource).toContain("bg-primary/95");
    expect(vendorCardSource).toContain("detailsRevealOnHover");
    expect(vendorCardSource).toContain("group-hover:flex");
    expect(vendorCardSource).toContain("group-focus-within:flex");
    expect(activityCardSource).toContain("aria-expanded");
    expect(vendorCardSource).toContain("aria-expanded");
  });

  it("uses the compact map-style reveal across the homepage product and vendor cards", () => {
    const forYouStart = homeSource.indexOf('aria-labelledby="for-you-heading"');
    const forYouEnd = homeSource.indexOf("<EventPartnersSection", forYouStart);
    const forYouSection = homeSource.slice(forYouStart, forYouEnd);
    const highlightsStart = homeSource.indexOf('aria-labelledby="featured-highlights-heading"');
    const highlightsEnd = homeSource.indexOf("</section>", highlightsStart);
    const highlightsSection = homeSource.slice(highlightsStart, highlightsEnd);
    const featuredVendorStart = homeSource.indexOf("return <VendorCard");
    const featuredVendorEnd = homeSource.indexOf(" />;", featuredVendorStart);
    const featuredVendorCall = homeSource.slice(featuredVendorStart, featuredVendorEnd);

    expect(forYouSection).toContain("forYouItems.map((activity)");
    expect(forYouSection).toContain('detailsRevealStyle="caption"');
    expect(highlightsSection).toContain('detailsRevealStyle="caption"');
    expect(featuredVendorCall).toContain('detailsRevealStyle="caption"');
    expect(homeSource).toContain('id="featured-highlights-heading" className="font-[family-name:var(--font-display)] text-2xl');
    expect(homeSource).toContain('id="for-you-heading" className="flex items-center gap-2 font-[family-name:var(--font-display)] text-2xl');
    expect(homeSource).toContain('text-2xl font-bold font-[family-name:var(--font-display)]');
  });

  it("keeps generic marketing copy out of the customer home", () => {
    expect(homeSource).not.toContain("heroDescription");
    expect(homeSource).not.toContain("featuredHighlightsSubtitle");
    expect(homeSource).not.toContain("eventCalendarKicker");
    expect(homeSource).not.toContain("eventCalendarPromptDescription");
    expect(homeSource).not.toContain("wanderWays");
    expect(homeSource).toContain('t("ui.home.exploreMalaysia")');
  });

  it("does not expose vendor business-type translation keys in Featured Partners cards", () => {
    expect(homeSource).not.toContain("ui.vendor.businessTypes");
    expect(homeSource).not.toContain("customer:ui.vendor");
    expect(homeSource).toContain('t("ui.home.vendorDescription", { location })');
  });

  it("offers a customer event calendar popup from the home route", () => {
    expect(homeSource).toContain("EventCalendarDialog");
    expect(homeSource).toContain('t("ui.home.viewEventCalendar")');
    expect(homeSource).toContain('aria-label={t("ui.home.eventCalendar")');
  });
});
