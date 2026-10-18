import { describe, expect, it } from "vitest";
import { checkoutPrepareSchema } from "../schemas";

const baseCheckout = {
  paymentMethod: "stripe_card",
  idempotencyKey: "123e4567-e89b-12d3-a456-426614174000",
};

describe("hotel stay checkout details", () => {
  it("accepts bounded guest preferences in the checkout request", () => {
    const parsed = checkoutPrepareSchema.safeParse({
      ...baseCheckout,
      stayDetails: {
        adults: 2,
        estimatedArrival: "18:00-21:00",
        secondGuestName: "Sam Lee",
        specialRequest: "A quiet room, if available.",
      },
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects invalid guest counts, arrival options and unexpected fields", () => {
    const invalidAdults = checkoutPrepareSchema.safeParse({
      ...baseCheckout,
      stayDetails: { adults: 0, estimatedArrival: "unknown" },
    });
    const invalidArrival = checkoutPrepareSchema.safeParse({
      ...baseCheckout,
      stayDetails: { adults: 2, estimatedArrival: "whenever" },
    });
    const extraField = checkoutPrepareSchema.safeParse({
      ...baseCheckout,
      stayDetails: { adults: 2, estimatedArrival: "unknown", userId: "another-user" },
    });

    expect(invalidAdults.success).toBe(false);
    expect(invalidArrival.success).toBe(false);
    expect(extraField.success).toBe(false);
  });
});
