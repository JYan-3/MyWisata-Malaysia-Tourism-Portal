import { describe, expect, it } from "vitest";
import { endOfPickupDay, signEventPickupToken, verifyEventPickupToken } from "@/lib/events/event-pickup-token";

const claims = {
  orderId: "11111111-1111-4111-8111-111111111111",
  vendorId: "22222222-2222-4222-8222-222222222222",
  locationId: "33333333-3333-4333-8333-333333333333",
  pickupDate: "2026-10-05",
  issuedAt: 1,
};
const secret = "test-secret";

describe("event pickup token", () => {
  it("round-trips its claims", () => {
    const result = verifyEventPickupToken(signEventPickupToken(claims, secret), secret, endOfPickupDay("2026-10-04"));
    expect(result.valid).toBe(true);
    expect(result.claims).toMatchObject({ ...claims, kind: "event_pickup" });
  });

  it("stays valid through the pickup day in Malaysia and expires right after", () => {
    const token = signEventPickupToken(claims, secret);
    const lastSecond = Math.floor(new Date("2026-10-05T23:59:59+08:00").getTime() / 1000);
    expect(verifyEventPickupToken(token, secret, lastSecond).valid).toBe(true);
    const next = verifyEventPickupToken(token, secret, lastSecond + 1);
    expect(next.valid).toBe(false);
    expect(next).toMatchObject({ expired: true });
  });

  it("rejects a tampered or foreign token", () => {
    const token = signEventPickupToken(claims, secret);
    expect(verifyEventPickupToken(token, "other-secret").valid).toBe(false);
    const [version, , signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...claims, vendorId: "44444444-4444-4444-8444-444444444444", kind: "event_pickup", exp: 9e9 })).toString("base64url");
    expect(verifyEventPickupToken(`${version}.${forged}.${signature}`, secret).valid).toBe(false);
    expect(verifyEventPickupToken("food1.abc.def", secret).valid).toBe(false);
  });
});
