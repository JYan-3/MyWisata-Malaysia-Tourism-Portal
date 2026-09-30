import { createHmac, timingSafeEqual } from "node:crypto";

// Signed QR payload for collecting event reservations — same scheme as the
// food order token (lib/food/food-fulfilment-token.ts). One code per order,
// vendor, location and pickup date; it expires at the end of the pickup day
// in Malaysia time, and fulfil_event_pickup re-checks the date on scan.

export interface EventPickupClaims {
  kind: "event_pickup";
  orderId: string;
  vendorId: string;
  locationId: string;
  /** YYYY-MM-DD, Malaysia calendar date. */
  pickupDate: string;
  issuedAt: number;
  exp: number;
}

function getSecret() {
  return process.env.EVENT_PICKUP_QR_SECRET
    || process.env.FOOD_ORDER_QR_SECRET
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || "mywisata-event-pickup-signing-secret-dev";
}

function encode(value: string | Buffer) {
  return (typeof value === "string" ? Buffer.from(value) : value).toString("base64url");
}

/** Last second of the pickup date in Malaysia (UTC+8, no daylight saving). */
export function endOfPickupDay(pickupDate: string) {
  return Math.floor(new Date(`${pickupDate}T23:59:59+08:00`).getTime() / 1000);
}

export function signEventPickupToken(claims: Omit<EventPickupClaims, "kind" | "exp">, secret = getSecret()) {
  const payload = encode(JSON.stringify({ ...claims, kind: "event_pickup", exp: endOfPickupDay(claims.pickupDate) }));
  const input = "evt1." + payload;
  return input + "." + encode(createHmac("sha256", secret).update(input).digest());
}

export function verifyEventPickupToken(token: string, secret = getSecret(), nowSeconds = Math.floor(Date.now() / 1000)) {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "evt1") return { valid: false as const };
  const [version, payload, signature] = parts;
  const expected = createHmac("sha256", secret).update(version + "." + payload).digest();
  const received = Buffer.from(signature, "base64url");
  if (received.length !== expected.length || !timingSafeEqual(expected, received)) return { valid: false as const };
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as EventPickupClaims;
    if (claims.kind !== "event_pickup" || !claims.orderId || !claims.vendorId || !claims.locationId
      || !/^\d{4}-\d{2}-\d{2}$/.test(claims.pickupDate ?? "") || !Number.isFinite(claims.exp)) return { valid: false as const };
    if (claims.exp < nowSeconds) return { valid: false as const, expired: true as const, claims };
    return { valid: true as const, claims };
  } catch {
    return { valid: false as const };
  }
}
