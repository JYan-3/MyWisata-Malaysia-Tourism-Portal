import { describe, expect, it } from "vitest";
import { croppedFileName, croppedOutputSize, croppedOutputType, needsCrop } from "@/lib/media/image-aspect";

describe("needsCrop", () => {
  it("passes photos that already match the shape, within 2%", () => {
    expect(needsCrop(1600, 1200, "photo")).toBe(false);
    expect(needsCrop(4032, 3024, "photo")).toBe(false);
    expect(needsCrop(1000, 1015, "square")).toBe(false);
    expect(needsCrop(1920, 1080, "banner")).toBe(false);
  });

  it("asks for a crop when the shape differs", () => {
    expect(needsCrop(3024, 4032, "photo")).toBe(true);
    expect(needsCrop(1920, 1080, "photo")).toBe(true);
    expect(needsCrop(1600, 1200, "square")).toBe(true);
    expect(needsCrop(1600, 1200, "cover")).toBe(true);
  });

  it("does not ask for a crop when the size is unknown", () => {
    expect(needsCrop(0, 0, "photo")).toBe(false);
    expect(needsCrop(Number.NaN, 100, "photo")).toBe(false);
  });
});

describe("cropped output", () => {
  it("scales the long side down to 2000 px and keeps the shape", () => {
    expect(croppedOutputSize({ width: 4000, height: 3000 })).toEqual({ width: 2000, height: 1500 });
    expect(croppedOutputSize({ width: 1200, height: 1200 })).toEqual({ width: 1200, height: 1200 });
  });

  it("keeps PNG and WebP, turns anything else into JPEG, and fixes the extension", () => {
    expect(croppedOutputType("image/png")).toBe("image/png");
    expect(croppedOutputType("image/webp")).toBe("image/webp");
    expect(croppedOutputType("image/jpeg")).toBe("image/jpeg");
    expect(croppedOutputType("image/heic")).toBe("image/jpeg");
    expect(croppedFileName("IMG_1234.HEIC", "image/jpeg")).toBe("IMG_1234.jpg");
    expect(croppedFileName("logo.png", "image/png")).toBe("logo.png");
    expect(croppedFileName(".jpg", "image/jpeg")).toBe("photo.jpg");
  });
});
