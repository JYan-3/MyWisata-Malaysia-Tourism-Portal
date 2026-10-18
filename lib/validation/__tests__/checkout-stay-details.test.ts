import { describe, expect, it } from "vitest";
import * as schemas from "../schemas";

const baseCheckout = {
  paymentMethod: "stripe_card",
  idempotencyKey: "123e4567-e89b-12d3-a456-426614174000",
};

const stayDetailsSchema = (schemas as unknown as {
  stayBookingDetailsSchema?: { safeParse: (value: unknown) => { success: boolean } };
}).stayBookingDetailsSchema;

describe("accommodation guest details", () => {
  it("accepts one primary guest and optional additional guests up to the adult count", () => {
    expect(stayDetailsSchema?.safeParse({
      primaryGuestName: "Nur Aisyah",
      additionalGuestNames: ["Sam Lee"],
      adults: 2,
      estimatedArrival: "18:00-21:00",
      specialRequest: "A quiet room, if available.",
    }).success).toBe(true);

    expect(stayDetailsSchema?.safeParse({
      primaryGuestName: "Nur Aisyah",
      adults: 1,
      estimatedArrival: "unknown",
    }).success).toBe(true);
  });

  it("rejects a missing or blank primary guest, too many additional guests, and invalid preferences", () => {
    expect(stayDetailsSchema?.safeParse({ adults: 1, estimatedArrival: "unknown" }).success).toBe(false);
    expect(stayDetailsSchema?.safeParse({ primaryGuestName: "  ", adults: 1, estimatedArrival: "unknown" }).success).toBe(false);
    expect(stayDetailsSchema?.safeParse({
      primaryGuestName: "Nur Aisyah",
      additionalGuestNames: ["Sam Lee", "Alex Tan"],
      adults: 2,
      estimatedArrival: "unknown",
    }).success).toBe(false);
    expect(stayDetailsSchema?.safeParse({
      primaryGuestName: "Nur Aisyah",
      adults: 1,
      estimatedArrival: "whenever",
    }).success).toBe(false);
    expect(stayDetailsSchema?.safeParse({
      primaryGuestName: "Nur Aisyah",
      adults: 1,
      estimatedArrival: "unknown",
      passportNumber: "must-not-be-collected",
    }).success).toBe(false);
  });

  it("does not accept guest details from the shared checkout request", () => {
    expect(schemas.checkoutPrepareSchema.safeParse({
      ...baseCheckout,
      stayDetails: {
        adults: 1,
        estimatedArrival: "unknown",
      },
    }).success).toBe(false);
  });
});
