import { createHash } from "node:crypto";
import type { StayBookingDetails } from "@/backend/core/types";

export type CheckoutRequest = {
  selectedKeys?: string[];
  voucherCode?: string | null;
  claimId?: string | null;
  paymentMethod: string;
  paymentProvider?: string | null;
  foodServiceModes?: { outletId: string; mode: "dine_in" | "takeaway" }[];
  stayDetails?: StayBookingDetails;
};

export type NormalizedCheckoutRequest = {
  selectedKeys: string[] | null;
  voucherCode: string | null;
  claimId: string | null;
  paymentMethod: string;
  paymentProvider: string | null;
  foodServiceModes: { outletId: string; mode: "dine_in" | "takeaway" }[];
  stayDetails?: StayBookingDetails;
};

export function normalizeCheckoutRequest(input: CheckoutRequest): NormalizedCheckoutRequest {
  const selectedKeys = input.selectedKeys?.length
    ? [...new Set(input.selectedKeys)].sort()
    : null;

  return {
    selectedKeys,
    voucherCode: input.voucherCode?.trim().toUpperCase() || null,
    claimId: input.claimId?.trim() || null,
    paymentMethod: input.paymentMethod.trim().toLowerCase(),
    paymentProvider: input.paymentProvider?.trim().toLowerCase() || null,
    foodServiceModes: [...(input.foodServiceModes ?? [])]
      .map(({ outletId, mode }) => ({ outletId: outletId.trim().toLowerCase(), mode }))
      .sort((a, b) => a.outletId.localeCompare(b.outletId)),
    ...(input.stayDetails ? { stayDetails: input.stayDetails } : {}),
  };
}

export function buildCheckoutRequestHash(input: NormalizedCheckoutRequest & { subject?: unknown; contact?: unknown }): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export function createIdempotencyKey(): string {
  return crypto.randomUUID();
}
