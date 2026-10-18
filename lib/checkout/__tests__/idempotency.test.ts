import { describe, expect, it } from "vitest";
import { buildCheckoutRequestHash, normalizeCheckoutRequest } from "../idempotency";
import { cartItemKey } from "@/backend/core/helpers";

describe("checkout idempotency request", () => {
  it("normalizes selected keys so retries with different ordering share a hash", () => {
    const first = normalizeCheckoutRequest({
      selectedKeys: ["b|v|s", "a|v|"],
      voucherCode: " travel10 ",
      paymentMethod: "stripe_card",
    });
    const second = normalizeCheckoutRequest({
      selectedKeys: ["a|v|", "b|v|s"],
      voucherCode: "TRAVEL10",
      paymentMethod: "stripe_card",
    });

    expect(first).toEqual(second);
    expect(buildCheckoutRequestHash(first)).toBe(buildCheckoutRequestHash(second));
  });

  it("gives two stays with the same check-in but different nights different retry hashes", () => {
    const stay = { activityId: "room", variantId: "", slotId: "night-24-oct", outletId: "hotel" };
    const twoNights = normalizeCheckoutRequest({ selectedKeys: [cartItemKey({ ...stay, nights: 2 })], paymentMethod: "stripe_card" });
    const threeNights = normalizeCheckoutRequest({ selectedKeys: [cartItemKey({ ...stay, nights: 3 })], paymentMethod: "stripe_card" });

    expect(buildCheckoutRequestHash(twoNights)).not.toBe(buildCheckoutRequestHash(threeNights));
  });

  it("normalizes a claimed voucher ID and includes it in the idempotency hash", () => {
    const withClaim = normalizeCheckoutRequest({
      selectedKeys: ["a|v|"],
      voucherCode: " travel10 ",
      claimId: " claim-123 ",
      paymentMethod: "stripe_card",
    });
    const withoutClaim = normalizeCheckoutRequest({
      selectedKeys: ["a|v|"],
      voucherCode: "TRAVEL10",
      paymentMethod: "stripe_card",
    });

    expect(withClaim.claimId).toBe("claim-123");
    expect(buildCheckoutRequestHash(withClaim)).not.toBe(buildCheckoutRequestHash(withoutClaim));
  });

  it("includes one normalized service mode per outlet in the retry hash", () => {
    const first = normalizeCheckoutRequest({
      selectedKeys: ["food"],
      paymentMethod: "stripe_card",
      foodServiceModes: [
        { outletId: "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB", mode: "takeaway" },
        { outletId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", mode: "dine_in" },
      ],
    });
    const retry = normalizeCheckoutRequest({
      selectedKeys: ["food"],
      paymentMethod: "stripe_card",
      foodServiceModes: [
        { outletId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", mode: "dine_in" },
        { outletId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", mode: "takeaway" },
      ],
    });
    const changed = normalizeCheckoutRequest({
      selectedKeys: ["food"],
      paymentMethod: "stripe_card",
      foodServiceModes: [{ outletId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", mode: "takeaway" }],
    });

    expect(buildCheckoutRequestHash(first)).toBe(buildCheckoutRequestHash(retry));
    expect(buildCheckoutRequestHash(first)).not.toBe(buildCheckoutRequestHash(changed));
  });
});
