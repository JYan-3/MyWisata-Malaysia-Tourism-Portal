import { createProviderSlotGate } from "@/lib/weather/provider-slot";

const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 12;
const MAX_TRACKED_USERS = 5_000;
const userRequests = new Map<string, number[]>();
const providerGate = createProviderSlotGate({ maxRunning: 3, maxWaiters: 12 });

export function consumeWeatherRadarRateLimit(userId: string, now = Date.now()) {
  let recent = userRequests.get(userId) ?? [];
  if (userRequests.size >= MAX_TRACKED_USERS && !userRequests.has(userId)) {
    for (const [key, timestamps] of userRequests) {
      if (!timestamps.some((timestamp) => timestamp > now - RATE_WINDOW_MS)) userRequests.delete(key);
    }
    if (userRequests.size >= MAX_TRACKED_USERS) return false;
  }
  recent = recent.filter((timestamp) => timestamp > now - RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    userRequests.set(userId, recent);
    return false;
  }
  recent.push(now);
  userRequests.set(userId, recent);
  return true;
}

export function withWeatherRadarProviderSlot<T>(work: () => Promise<T>, signal?: AbortSignal) {
  return providerGate.run(work, signal);
}

export function __resetWeatherRadarRouteStateForTests() {
  userRequests.clear();
  providerGate.resetForTests();
}
