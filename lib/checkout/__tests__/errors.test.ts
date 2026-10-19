import { describe, expect, it } from "vitest";
import { activeCheckoutOrderId, getCheckoutErrorCode, getCheckoutErrorMessage } from "../errors";

describe("checkout error handling", () => {
  it('provides pending-order recovery without exposing arbitrary SQL detail', () => {
    expect(getCheckoutErrorCode('active_checkout_exists')).toBe('ACTIVE_CHECKOUT_EXISTS');
    expect(getCheckoutErrorMessage('ACTIVE_CHECKOUT_EXISTS')).toContain('cancel');
    expect(getCheckoutErrorCode('checkout_commitment_unavailable')).toBe('CHECKOUT_COMMITMENT_UNAVAILABLE');
    const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    expect(activeCheckoutOrderId(JSON.stringify({order_id:id}))).toBe(id);
    expect(activeCheckoutOrderId('{"order_id":"javascript:alert(1)"}')).toBeUndefined();
    expect(activeCheckoutOrderId('private database details')).toBeUndefined();
  });
  it("maps a platform order pause to a temporary checkout response", () => {
    expect(getCheckoutErrorCode("new_orders_paused")).toBe("NEW_ORDERS_PAUSED");
    expect(getCheckoutErrorMessage("new_orders_paused")).toContain("temporarily unavailable");
  });
  it("maps the atomic booking capacity error to an actionable message", () => {
    expect(getCheckoutErrorCode("booking_capacity_unavailable")).toBe("BOOKING_CAPACITY_UNAVAILABLE");
    expect(getCheckoutErrorMessage("booking_capacity_unavailable")).toContain("choose another available slot");
  });

  it("maps structured API errors as well as raw database messages", () => {
    expect(getCheckoutErrorCode({ code: "BOOKING_SLOT_INVALID", message: "booking_slot_invalid" })).toBe("BOOKING_SLOT_INVALID");
    expect(getCheckoutErrorMessage({ code: "INVENTORY_UNAVAILABLE" })).toContain("requested quantity");
  });

  it("explains how to recover when a cart item is no longer available", () => {
    expect(getCheckoutErrorCode({ code: "CART_ITEM_UNAVAILABLE" })).toBe("CART_ITEM_UNAVAILABLE");
    expect(getCheckoutErrorMessage({ code: "CART_ITEM_UNAVAILABLE" })).toContain("Refresh your cart");
  });

  it("does not expose database error text for unknown failures", () => {
    expect(getCheckoutErrorMessage("some_internal_postgres_error")).toBe("We could not start checkout right now. Please try again.");
  });

  it("maps voucher validation failures to actionable customer messages", () => {
    expect(getCheckoutErrorCode("voucher_minimum_spend")).toBe("VOUCHER_MINIMUM_SPEND");
    expect(getCheckoutErrorMessage("voucher_minimum_spend")).toContain("minimum spend");
    expect(getCheckoutErrorMessage("voucher_discount_mismatch")).toContain("discount could not be verified");
  });

  it("maps claimed voucher checkout failures without exposing database text", () => {
    expect(getCheckoutErrorCode("voucher_claim_expired")).toBe("VOUCHER_CLAIM_EXPIRED");
    expect(getCheckoutErrorMessage("voucher_claim_mismatch")).toContain("does not match");
    expect(getCheckoutErrorMessage("voucher_claim_hold_missing")).toContain("no longer available");
  });
});
