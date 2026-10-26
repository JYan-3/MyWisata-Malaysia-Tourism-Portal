import { afterEach, describe, expect, it } from "vitest";
import { __resetWeatherRadarRouteStateForTests, consumeWeatherRadarRateLimit } from "../route-state";

afterEach(() => __resetWeatherRadarRouteStateForTests());

describe("weather radar route state bounds", () => {
  it("expires idle user keys and rejects excess tracked users without evicting live limits", () => {
    const now = 1_000_000;
    for (let index = 0; index < 5_000; index += 1) {
      expect(consumeWeatherRadarRateLimit(`user-${index}`, now)).toBe(true);
    }
    expect(consumeWeatherRadarRateLimit("overflow", now)).toBe(false);
    expect(consumeWeatherRadarRateLimit("after-expiry", now + 60_001)).toBe(true);
    expect(consumeWeatherRadarRateLimit("user-4999", now + 60_001)).toBe(true);
  });
});
