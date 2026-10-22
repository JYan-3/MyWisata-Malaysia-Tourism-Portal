import { describe, expect, it } from "vitest";
import { resolveCartLinePrice, canMergeCartItemLines, canTransition, cartItemKey, cartTotals, haversineKm, validateVoucher, voucherDiscount } from "../helpers";
import type { Activity, Voucher } from "../types";

const activity: Activity = {
  id: "a1", outletId: "o1", name: "Test Activity", category: "Food & Dining",
  description: "", image: "", price: 100, rating: 4.5, reviews: 10, duration: "2 hrs",
  requiresBooking: true,
  variants: [
    { id: "adult", label: "Adult", priceDelta: 0 },
    { id: "child", label: "Child", priceDelta: -15 },
  ],
};

const now = new Date("2026-07-10T00:00:00Z");

describe("validateVoucher", () => {
  const base: Voucher = { id: "v1", code: "TEST", type: "percent", value: 10, minSpend: 0, usageCap: 10, usageCount: 0, expiresAt: "2026-12-31" };

  it("accepts a valid voucher", () => {
    expect(validateVoucher(base, 100, now)).toEqual({ ok: true });
  });

  it("rejects an expired voucher", () => {
    expect(validateVoucher({ ...base, expiresAt: "2026-01-01" }, 100, now)).toMatchObject({ ok: false });
  });

  it("rejects when usage cap reached", () => {
    expect(validateVoucher({ ...base, usageCount: 10 }, 100, now)).toMatchObject({ ok: false });
  });

  it("rejects when minimum spend not met", () => {
    expect(validateVoucher({ ...base, minSpend: 300 }, 100, now)).toMatchObject({ ok: false });
  });
});

describe("voucherDiscount", () => {
  it("computes percent discount", () => {
    const v: Voucher = { id: "v1", code: "P10", type: "percent", value: 10, minSpend: 0, usageCap: 10, usageCount: 0, expiresAt: "2026-12-31" };
    expect(voucherDiscount(v, 200)).toBe(20);
  });

  it("computes fixed discount, capped at subtotal", () => {
    const v: Voucher = { id: "v2", code: "F50", type: "fixed", value: 50, minSpend: 0, usageCap: 10, usageCount: 0, expiresAt: "2026-12-31" };
    expect(voucherDiscount(v, 30)).toBe(30);
  });
});

describe("cartTotals", () => {
  it("sums qty * unit price across variants", () => {
    const totals = cartTotals(
      [{ activityId: "a1", variantId: "adult", qty: 2 }, { activityId: "a1", variantId: "child", qty: 1 }],
      [activity],
    );
    // 2*100 + 1*85 = 285
    expect(totals.subtotal).toBe(285);
    expect(totals.total).toBe(285);
  });

  it("applies a valid voucher discount to total", () => {
    const voucher: Voucher = { id: "v1", code: "TEST", type: "percent", value: 10, minSpend: 0, usageCap: 10, usageCount: 0, expiresAt: "2026-12-31" };
    const totals = cartTotals([{ activityId: "a1", variantId: "adult", qty: 1 }], [activity], voucher, now);
    expect(totals.discount).toBe(10);
    expect(totals.total).toBe(90);
    expect(totals.voucherError).toBeUndefined();
  });

  it("limits vendor and outlet voucher discounts to matching cart lines", () => {
    const vendorA = Object.assign({}, activity, { vendorId: "vendor-a" }) as Activity;
    const vendorB = Object.assign({}, activity, { id: "b1", outletId: "outlet-b", vendorId: "vendor-b" }) as Activity;
    const voucher = Object.assign({
      id: "v-scope", code: "A10", type: "percent", value: 10, minSpend: 0,
      usageCap: 10, usageCount: 0, expiresAt: "2026-12-31",
    }, { vendorId: "vendor-a", outletId: "o1" }) as Voucher;

    const totals = cartTotals([
      { activityId: "a1", variantId: "adult", outletId: "o1", qty: 1 },
      { activityId: "b1", variantId: "adult", outletId: "outlet-b", qty: 1 },
    ], [vendorA, vendorB], voucher, now);

    expect(totals.subtotal).toBe(200);
    expect(totals.discount).toBe(10);
    expect(totals.total).toBe(190);
  });

  it("applies a product voucher only to that product's eligible subtotal", () => {
    const eligible = Object.assign({}, activity, { vendorId: "vendor-a" }) as Activity;
    const other = Object.assign({}, activity, { id: "b1", outletId: "o1", vendorId: "vendor-a" }) as Activity;
    const voucher = Object.assign({
      id: "v-product", code: "P10", type: "percent", value: 10, minSpend: 0,
      usageCap: 10, usageCount: 0, expiresAt: "2026-12-31",
    }, { vendorId: "vendor-a", productId: "a1" }) as Voucher;

    const totals = cartTotals([
      { activityId: "a1", variantId: "adult", outletId: "o1", qty: 1 },
      { activityId: "b1", variantId: "adult", outletId: "o1", qty: 1 },
    ], [eligible, other], voucher, now);

    expect(totals.discount).toBe(10);
    expect(totals.total).toBe(190);
  });

  it("checks minimum spend against the voucher-eligible subtotal", () => {
    const vendorA = Object.assign({}, activity, { vendorId: "vendor-a" }) as Activity;
    const vendorB = Object.assign({}, activity, { id: "b1", outletId: "outlet-b", vendorId: "vendor-b" }) as Activity;
    const voucher = Object.assign({
      id: "v-min", code: "A10", type: "fixed", value: 10, minSpend: 150,
      usageCap: 10, usageCount: 0, expiresAt: "2026-12-31",
    }, { vendorId: "vendor-a" }) as Voucher;

    const totals = cartTotals([
      { activityId: "a1", variantId: "adult", outletId: "o1", qty: 1 },
      { activityId: "b1", variantId: "adult", outletId: "outlet-b", qty: 1 },
    ], [vendorA, vendorB], voucher, now);

    expect(totals.voucherError).toBeDefined();
    expect(totals.discount).toBe(0);
  });

  it("surfaces an error and skips discount for an invalid voucher", () => {
    const voucher: Voucher = { id: "v2", code: "EXP", type: "fixed", value: 5, minSpend: 0, usageCap: 10, usageCount: 0, expiresAt: "2026-01-01" };
    const totals = cartTotals([{ activityId: "a1", variantId: "adult", qty: 1 }], [activity], voucher, now);
    expect(totals.discount).toBe(0);
    expect(totals.total).toBe(100);
    expect(totals.voucherError).toBeDefined();
  });
});

describe("haversineKm", () => {
  it("returns 0 for identical points", () => {
    expect(haversineKm({ lat: 3.139, lng: 101.6869 }, { lat: 3.139, lng: 101.6869 })).toBe(0);
  });

  it("computes a plausible KL-to-Penang distance", () => {
    const km = haversineKm({ lat: 3.139, lng: 101.6869 }, { lat: 5.4141, lng: 100.3288 });
    expect(km).toBeGreaterThan(250);
    expect(km).toBeLessThan(300);
  });
});

describe("order state machine", () => {
  it("allows DRAFT -> PENDING_PAYMENT -> PAID -> COMPLETED", () => {
    expect(canTransition("DRAFT", "PENDING_PAYMENT")).toBe(true);
    expect(canTransition("PENDING_PAYMENT", "PAID")).toBe(true);
    expect(canTransition("PAID", "COMPLETED")).toBe(true);
  });

  it("allows cancellation before completion", () => {
    expect(canTransition("PENDING_PAYMENT", "CANCELLED")).toBe(true);
    expect(canTransition("PAID", "CANCELLED")).toBe(true);
  });

  it("disallows skipping states or transitioning out of terminal states", () => {
    expect(canTransition("DRAFT", "PAID")).toBe(false);
    expect(canTransition("COMPLETED", "CANCELLED")).toBe(false);
    expect(canTransition("CANCELLED", "PAID")).toBe(false);
  });
});

describe("selected outlet pricing", () => {
  const offered = {...activity, offers:[{outletId:"o1",price:10,status:"active"},{outletId:"o2",price:20,status:"active"}]};
  it("uses the selected outlet in row, totals and scoped vouchers", () => {
    const line={activityId:"a1",variantId:"adult",outletId:"o2",qty:2};
    expect(resolveCartLinePrice(offered,line,{now,productIds:["a1"]})).toEqual({available:true,unitPrice:20});
    const voucher:Voucher={id:"v",code:"TEST",type:"percent",value:10,minSpend:0,usageCap:10,usageCount:0,expiresAt:"2030-01-01",outletId:"o2"};
    expect(cartTotals([line],[offered],voucher,now)).toMatchObject({subtotal:40,discount:4,total:36});
  });
  it("does not substitute another outlet or treat an invalid price as free", () => {
    expect(resolveCartLinePrice(offered,{activityId:"a1",variantId:"adult",outletId:"missing",qty:1},{now,productIds:[]})).toEqual({available:false,reason:"outlet_unavailable"});
    expect(resolveCartLinePrice({...activity,price:NaN},{activityId:"a1",variantId:"adult",qty:1},{now,productIds:[]})).toEqual({available:false,reason:"invalid_price"});
    expect(resolveCartLinePrice({...activity,price:0},{activityId:"a1",variantId:"adult",qty:1},{now,productIds:[]})).toEqual({available:true,unitPrice:0});
  });
  it("retains trusted prepared and slot overrides with variant and rounding rules",()=>{
    const line={activityId:"a1",variantId:"child",outletId:"o2",qty:1};
    expect(resolveCartLinePrice(offered,line,{now,productIds:[]})).toEqual({available:true,unitPrice:5});
    expect(resolveCartLinePrice(offered,{...line,priceOverride:7},{now,productIds:[],slotPriceOverride:8})).toEqual({available:true,unitPrice:7});
    expect(resolveCartLinePrice(offered,line,{now,productIds:[],slotPriceOverride:8})).toEqual({available:true,unitPrice:8});
  });
});

describe("cartItemKey nights", () => {
  it("distinguishes stay lengths and defaults to 1 night", async () => {
    const base = { activityId: "a", variantId: "v", slotId: "s", outletId: "o" };
    expect(cartItemKey(base)).toBe("a|v|s|o");
    expect(cartItemKey({ ...base, nights: 3 })).not.toBe(cartItemKey({ ...base, nights: 2 }));
  });

  it("uses a saved row UUID instead of personal details for persisted cart identity", () => {
    const base = { activityId: "room", variantId: "v", slotId: "night", outletId: "hotel", nights: 1 };
    const first = cartItemKey({ ...base, cartItemId: "saved-line-1", stayDetails: { primaryGuestName: "A", adults: 1, estimatedArrival: "unknown" } });
    const second = cartItemKey({ ...base, cartItemId: "saved-line-2", stayDetails: { primaryGuestName: "B", adults: 1, estimatedArrival: "unknown" } });

    expect(first).toBe("cart-item:saved-line-1");
    expect(second).toBe("cart-item:saved-line-2");
    expect(first).not.toContain("A");
    expect(second).not.toContain("B");
  });
});

describe("cart line merging", () => {
  const stay = {
    activityId: "room", variantId: "v", slotId: "night", outletId: "hotel", nights: 1, qty: 1,
    stayDetails: { primaryGuestName: "Nur", additionalGuestNames: ["Sam"], adults: 2, estimatedArrival: "unknown" as const },
  };

  it("merges accommodation lines only when their stored guest details match", () => {
    expect(canMergeCartItemLines(stay, { ...stay, qty: 2 })).toBe(true);
    expect(canMergeCartItemLines(stay, { ...stay, stayDetails: { ...stay.stayDetails, primaryGuestName: "Lee" } })).toBe(false);
    expect(canMergeCartItemLines(stay, { ...stay, stayDetails: { ...stay.stayDetails, additionalGuestNames: ["Alex"] } })).toBe(false);
  });

  it("continues merging ordinary lines without stay details", () => {
    const ordinary = { activityId: "food", variantId: "v", slotId: undefined, outletId: "shop", qty: 1 };
    expect(canMergeCartItemLines(ordinary, { ...ordinary, qty: 2 })).toBe(true);
    expect(canMergeCartItemLines(ordinary, { ...ordinary, stayDetails: stay.stayDetails })).toBe(false);
  });
});
