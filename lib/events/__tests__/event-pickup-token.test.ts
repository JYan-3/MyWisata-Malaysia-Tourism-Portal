import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signEventPickupToken, verifyEventPickupToken } from "@/lib/events/event-pickup-token";

const SECRET = "event-pickup-token-test-secret";
const NOW_SECONDS = Math.floor(Date.parse("2026-10-07T00:00:00Z") / 1000);
const commonClaims = {
  orderId: "11111111-1111-4111-8111-111111111111",
  vendorId: "22222222-2222-4222-8222-222222222222",
  locationId: "33333333-3333-4333-8333-333333333333",
  pickupDate: "2099-12-31",
  issuedAt: NOW_SECONDS * 1000,
};

function signRawClaims(claims: Record<string, unknown>) {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const input = `evt1.${payload}`;
  const signature = createHmac("sha256", SECRET).update(input).digest("base64url");
  return `${input}.${signature}`;
}

describe("event pickup token slot claims", () => {
  it("verifies the slot id bound to a newly issued pickup code", () => {
    const token = signEventPickupToken({ ...commonClaims, pickupSlotId: "44444444-4444-4444-8444-444444444444" }, SECRET);

    expect(verifyEventPickupToken(token, SECRET, NOW_SECONDS).claims).toMatchObject({
      pickupSlotId: "44444444-4444-4444-8444-444444444444",
      pickupDate: "2099-12-31",
    });
  });

  it("continues to verify an unexpired date-only code issued before slot binding", () => {
    const token = signEventPickupToken(commonClaims, SECRET);

    expect(verifyEventPickupToken(token, SECRET, NOW_SECONDS)).toMatchObject({
      valid: true,
      claims: { orderId: commonClaims.orderId, pickupDate: commonClaims.pickupDate },
    });
  });

  it("rejects a signed token with a malformed pickup slot id", () => {
    const token = signRawClaims({
      ...commonClaims,
      kind: "event_pickup",
      pickupSlotId: "not-a-database-id",
      exp: NOW_SECONDS,
    });

    expect(verifyEventPickupToken(token, SECRET, NOW_SECONDS).valid).toBe(false);
  });
});
