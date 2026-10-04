import { describe, expect, it } from "vitest";
import { resolveOutletImage } from "@/lib/outlet-images";

describe("resolveOutletImage", () => {
  it("prefers an outlet hero image over a related place image", () => {
    expect(resolveOutletImage({
      outletName: "Kek Lok Si Temple — Main Entrance",
      outletHeroUrl: "https://example.com/outlet-hero.jpg",
      managedPlaceImages: [{ name: "Kek Lok Si Temple", imageUrl: "penang/kek-lok-si-temple.webp" }],
    })).toBe("https://example.com/outlet-hero.jpg");
  });

  it("uses the matching customer place image for an outlet", () => {
    expect(resolveOutletImage({
      outletName: "Kek Lok Si Temple — Main Entrance",
      outletHeroUrl: null,
      managedPlaceImages: [{ name: "Kek Lok Si Temple", imageUrl: "https://example.com/place.jpg" }],
    })).toBe("https://example.com/place.jpg");
  });

  it("does not assign an unrelated place image", () => {
    expect(resolveOutletImage({
      outletName: "Queensbay Mall",
      outletHeroUrl: null,
      managedPlaceImages: [{ name: "Kek Lok Si Temple", imageUrl: "https://example.com/place.jpg" }],
    })).toBeNull();
  });

  it("falls back to the first ordered outlet gallery photo and ignores logo media", () => {
    expect(resolveOutletImage({
      outletName: "Kooya Handicraft",
      outletHeroUrl: null,
      managedPlaceImages: [],
      outletGalleryImages: [
        { url: "https://example.com/kooya-logo.png", alt_text: "Kooya logo", media_type: "image", sort_order: -1 },
        { url: "https://example.com/kooya-second.jpg", alt_text: "Beaded craft display", media_type: "image", sort_order: 1 },
        { url: "https://example.com/kooya-first.jpg", alt_text: "Handmade beaded slippers", media_type: "image", sort_order: 0 },
      ],
    })).toBe("https://example.com/kooya-first.jpg");
  });

  it("prefers an outlet gallery photo over a same-name managed place fallback", () => {
    expect(resolveOutletImage({
      outletName: "Kooya Handicraft — Jalan Hang Jebat",
      outletHeroUrl: null,
      managedPlaceImages: [{ name: "Kooya Handicraft — Jalan Hang Jebat", imageUrl: "https://example.com/old-cemetery.jpg" }],
      outletGalleryImages: [{ url: "https://example.com/melaka-retail.jpg", alt_text: "Retail stalls in Melaka", media_type: "image", sort_order: 0 }],
    })).toBe("https://example.com/melaka-retail.jpg");
  });
});
