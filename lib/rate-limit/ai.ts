import { guestAddressRateKey, reserveGuestRateLimit } from '@/lib/checkout/guest-session';

// Caps AI provider calls per caller so one account, script or address can't run
// up the provider bill. Fixed 10-minute windows in the existing
// reserve_guest_rate_limit counter (one row per key). Fails closed: if the
// counter can't be reached the caller gets the non-AI path.
const WINDOW_SECONDS = 600;
const PER_USER = 30;
const PER_GUEST_ADDRESS = 10;
// Off Vercel the client address isn't trusted (see guestAddressRateKey), so all
// guests share one bucket; this then acts as a cap on total guest AI use.
const SHARED_GUEST_BUCKET = 100;

/** Reserves one AI call for this caller and feature; false means over the limit. */
export async function reserveAiQuota(request: Request, feature: string, userId: string | null, perUser = PER_USER): Promise<boolean> {
  if (userId) return reserveGuestRateLimit(`ai:${feature}:user:${userId}`, perUser, WINDOW_SECONDS);
  const address = guestAddressRateKey(request);
  const limit = address.endsWith(':unavailable') ? SHARED_GUEST_BUCKET : PER_GUEST_ADDRESS;
  return reserveGuestRateLimit(`ai:${feature}:${address}`, limit, WINDOW_SECONDS);
}
