import { createGuestSession, guestAddressRateKey, guestPrivateResponse, isSameOriginMutation, reserveGuestRateLimit, resolveGuestSession } from "@/lib/checkout/guest-session";
import { apiFail } from "@/lib/validation/schemas";

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return apiFail("FORBIDDEN", "Use the guest checkout form", 403);
  if (await resolveGuestSession(request)) return guestPrivateResponse({ ready: true });
  if (!await reserveGuestRateLimit(`session:${guestAddressRateKey(request)}`, 30, 900)) return apiFail("RATE_LIMITED", "Try again later", 429);
  return createGuestSession(request);
}
