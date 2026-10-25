import { afterEach, describe, expect, it } from "vitest";
import { __resetWeatherOverlayRouteStateForTests, consumeWeatherOverlayRateLimit } from "../route-state";

afterEach(() => __resetWeatherOverlayRouteStateForTests());

describe("weather overlay route state bounds", () => {
  it("expires idle user keys and rejects excess tracked users without evicting live limits", () => {
    const now = 1_000_000;
    for (let index = 0; index < 5_000; index += 1) {
      expect(consumeWeatherOverlayRateLimit(`user-${index}`, now)).toBe(true);
    }
    expect(consumeWeatherOverlayRateLimit("overflow", now)).toBe(false);
    expect(consumeWeatherOverlayRateLimit("after-expiry", now + 60_001)).toBe(true);
    expect(consumeWeatherOverlayRateLimit("user-4999", now + 60_001)).toBe(true);
  });
});
