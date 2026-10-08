import { describe, expect, it } from "vitest";

import {
  slotCreateSchema,
  slotFormSchema,
} from "@/lib/validation/vendor-schemas";

describe("slot form payload", () => {
  it("converts Malaysia datetime-local values into API timestamps", () => {
    const formValues = {
      productId: "5419b6d1-17ff-4191-9b3b-e80e35edcfab",
      outletId: "b9009043-21fb-bc6b-5d5c-737cfa57c329",
      startsAt: "2026-10-07T10:00",
      endsAt: "2026-10-07T11:00",
      capacity: 20,
    };
    const payload = slotFormSchema.parse(formValues);

    expect(payload.startsAt).toBe("2026-10-07T02:00:00.000Z");
    expect(payload.endsAt).toBe("2026-10-07T03:00:00.000Z");
    expect(slotCreateSchema.safeParse(formValues).success).toBe(false);
    expect(slotCreateSchema.safeParse(payload).success).toBe(true);
  });

  it("rejects malformed local times and end times that do not follow the start", () => {
    const formValues = {
      productId: "5419b6d1-17ff-4191-9b3b-e80e35edcfab",
      outletId: "b9009043-21fb-bc6b-5d5c-737cfa57c329",
      startsAt: "2026-10-07T10:00",
      endsAt: "2026-10-07T11:00",
      capacity: 20,
    };

    expect(slotFormSchema.safeParse({ ...formValues, startsAt: "2026-02-30T10:00" }).success).toBe(false);
    expect(slotFormSchema.safeParse({ ...formValues, endsAt: "2026-10-07T10:00" }).success).toBe(false);
  });

  it("accepts a blank optional price override without changing the API payload", () => {
    const parsed = slotFormSchema.safeParse({
      productId: "5419b6d1-17ff-4191-9b3b-e80e35edcfab",
      outletId: "b9009043-21fb-bc6b-5d5c-737cfa57c329",
      startsAt: "2026-10-07T10:00",
      endsAt: "2026-10-07T11:00",
      capacity: 20,
      priceOverride: "",
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.priceOverride).toBeUndefined();
      expect(slotCreateSchema.safeParse(parsed.data).success).toBe(true);
    }
  });

  it("normalizes a typed price override to the API number shape", () => {
    const parsed = slotFormSchema.safeParse({
      productId: "5419b6d1-17ff-4191-9b3b-e80e35edcfab",
      outletId: "b9009043-21fb-bc6b-5d5c-737cfa57c329",
      startsAt: "2026-10-07T10:00",
      endsAt: "2026-10-07T11:00",
      capacity: 20,
      priceOverride: "0.01",
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.priceOverride).toBe(0.01);
      expect(slotCreateSchema.safeParse(parsed.data).success).toBe(true);
    }
  });
});
