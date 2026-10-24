const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 6;
const userRequests = new Map<string, number[]>();

export function consumeWeatherForecastRateLimit(userId: string, now = Date.now()) {
  const recent = (userRequests.get(userId) ?? []).filter((timestamp) => timestamp > now - RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    userRequests.set(userId, recent);
    return false;
  }
  recent.push(now);
  if (!userRequests.has(userId) && userRequests.size >= 1000) userRequests.delete(userRequests.keys().next().value!);
  userRequests.set(userId, recent);
  return true;
}

export { withWeatherForecastProviderSlot } from "@/lib/weather/provider-slot";
import { resetWeatherProviderSlots } from "@/lib/weather/provider-slot";

export function __resetWeatherRouteStateForTests() {
  userRequests.clear();
  resetWeatherProviderSlots();
}
