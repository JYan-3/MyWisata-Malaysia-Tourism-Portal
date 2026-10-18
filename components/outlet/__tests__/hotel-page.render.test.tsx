import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { OutletRendererOutlet, OutletRendererProduct } from "@/components/outlet/outlet-block-types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, options?: Record<string, unknown>) => (options?.count !== undefined ? `${key}:${options.count}` : key), i18n: { language: "en" } }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/providers/cart", () => ({ useCart: () => ({ addItem: vi.fn(), setSelectedKeys: vi.fn() }) }));
vi.mock("@/components/providers/wishlist", () => ({ useWishlist: () => ({ savedOutletIds: new Set<string>(), toggleSavedOutlet: vi.fn() }) }));
vi.mock("@/components/customer/use-customer-capability-gate", () => ({ useCustomerCapabilityGate: () => Object.assign(() => true, { handleResponse: vi.fn() }) }));
vi.mock("@/components/providers/reference-currency", () => ({ useReferenceCurrency: () => ({ currency: "MYR", snapshot: null, convert: (v: number) => v }) }));

import { HotelPage } from "../hotel-page";
import { RoomDetailsContent } from "../room-details-dialog";
import { readRoomDetails } from "@/lib/customer/room-details";

const outlet: OutletRendererOutlet = {
  id: "hotel-1",
  name: "Pelangi Beach Resort & Spa",
  address: "Pantai Cenang",
  city: "Langkawi",
  state: "Kedah",
  stay: {
    checkIn: "2026-10-24", checkOut: "2026-10-27", nights: 3, rooms: 1, adults: 2,
    checkInTime: "15:00", checkOutTime: "12:00", policies: "Pets are not permitted.",
    about: "A beachfront resort.", amenities: [{ code: "wifi", label: "Free Wi-Fi", icon: "wifi" }], rating: 4.6, reviews: 12,
  },
};

function room(id: string, attributes: Record<string, unknown>, photos: string[] = []): OutletRendererProduct {
  return {
    id, name: `Room ${id}`, description: "A room.", base_price: 320, cover_url: null, requires_booking: true,
    stay: { total: 960, left: 5, checkInSlotId: `slot-${id}`, details: readRoomDetails(attributes), photos },
  };
}

const full = room("full", { bedType: "1 king bed", maxGuests: 3, sizeSqm: 46.5, view: "Sea view", smoking: "non_smoking", roomAmenities: ["Electronic safe"] }, ["https://example.com/a.jpg"]);
const empty = room("empty", {});

describe("hotel page", () => {
  it("renders rooms with Book and never links a room to the product page", () => {
    const markup = renderToStaticMarkup(<HotelPage outlet={outlet} rooms={[full, empty]} gallery={[]} />);
    expect(markup).toContain("Room full");
    expect(markup).toContain("ui.property.book");
    expect(markup).toContain("ui.hotel.roomDetails");
    expect(markup).toContain("Free Wi-Fi");
    expect(markup).toContain("A beachfront resort.");
    expect(markup).toContain("Pets are not permitted.");
    expect(markup).not.toContain("/customer/activity/");
  });

  it("lists a room's bed, size and amenities in the popup content", () => {
    const markup = renderToStaticMarkup(<RoomDetailsContent room={full} />);
    expect(markup).toContain("1 king bed");
    expect(markup).toContain("46.5");
    expect(markup).toContain("Sea view");
    expect(markup).toContain("Electronic safe");
    expect(markup).toContain("https://example.com/a.jpg");
  });

  it("renders a room with no details and no photos without empty rows", () => {
    const markup = renderToStaticMarkup(<><HotelPage outlet={outlet} rooms={[empty]} gallery={[]} /><RoomDetailsContent room={empty} /></>);
    expect(markup).not.toContain("undefined");
    expect(markup).not.toContain("ui.hotel.bed");
    expect(markup).not.toContain("ui.hotel.size");
    expect(markup).toContain("A room.");
  });

  it("is the public template for hotels while other outlets keep their blocks and menu", () => {
    const renderer = readFileSync(resolve(process.cwd(), "components/outlet/outlet-page-renderer.tsx"), "utf8");
    expect(renderer).toContain("<HotelPage");
    expect(renderer).not.toContain("StaySection");
    expect(renderer).toContain("<OutletMenu outlet={outlet} products={products} />");
  });

  it("formats prices with ReferencePrice, never inside a translation string", () => {
    const source = readFileSync(resolve(process.cwd(), "components/outlet/hotel-page.tsx"), "utf8");
    expect(source).toContain("<ReferencePrice");
    expect(source).not.toContain("ui.property.totalFor");
    expect(source).not.toContain("ui.outletMenu.price");
    expect(source).not.toMatch(/<(button|input)\b/);
  });

  it("renders the complete hotel search bar and real guest reviews", () => {
    const markup = renderToStaticMarkup(<HotelPage
      outlet={outlet}
      rooms={[full]}
      gallery={[]}
      reviews={[{
        id: "review-1",
        rating: 5,
        title: "A lovely stay",
        body: "The room was quiet and the staff were kind.",
        createdAt: "2026-09-12T10:00:00.000Z",
        authorName: "Aisyah R.",
        verifiedPurchase: true,
      }]}
    />);

    expect(markup).toContain("name=\"checkin\"");
    expect(markup).toContain("name=\"checkout\"");
    expect(markup).toContain("name=\"rooms\"");
    expect(markup).toContain("name=\"adults\"");
    expect(markup).toContain("A lovely stay");
    expect(markup).toContain("The room was quiet and the staff were kind.");
    expect(markup).toContain("ui.reviews.verifiedPurchase");
  });
});

describe("hotel page header", () => {
  it("names the hotel in the main heading with its rating and address", () => {
    const markup = renderToStaticMarkup(<HotelPage outlet={outlet} rooms={[empty]} gallery={[]} />);
    expect(markup).toMatch(/<h1[^>]*>Pelangi Beach Resort &amp; Spa<\/h1>/);
    expect(markup).toContain("4.6");
    expect(markup).toContain("Pantai Cenang");
  });

  it("hides the rating when the hotel has no reviews yet", () => {
    const markup = renderToStaticMarkup(<HotelPage outlet={{ ...outlet, stay: { ...outlet.stay!, rating: 0, reviews: 0 } }} rooms={[empty]} gallery={[]} />);
    expect(markup).not.toContain("ui.hotel.reviewCount");
  });
});
