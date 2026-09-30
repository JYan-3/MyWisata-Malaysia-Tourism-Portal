import { describe, expect, it } from 'vitest';
import {
  campaignListingUpdateSchema,
  campaignRegistrationProductSchema,
  contentReviewSchema,
  pickupSlotSchema,
  vendorRegisterSchema,
  voucherCreateSchema,
  voucherValidateSchema,
} from '@/lib/validation/vendor-schemas';

const validId = '11111111-1111-4111-8111-111111111111';

describe('contentReviewSchema', () => {
  it('accepts request changes with a meaningful note', () => {
    const result = contentReviewSchema.safeParse({
      entityType: 'product',
      entityId: validId,
      action: 'change_requested',
      note: 'Please add a clearer product image and update the availability details.',
    });

    expect(result.success).toBe(true);
  });

  it('requires a meaningful note when requesting changes or rejecting', () => {
    for (const action of ['change_requested', 'reject'] as const) {
      const result = contentReviewSchema.safeParse({
        entityType: 'product',
        entityId: validId,
        action,
        note: 'no',
      });

      expect(result.success).toBe(false);
    }
  });
});

describe('vendorRegisterSchema', () => {
  it('accepts an international contact number for the selected country', () => {
    const results = ['+12025550142', '+60177143951', '+601123456789', '0177143951'].map((contactPhone) => (
      vendorRegisterSchema.safeParse({ name: 'Valid Vendor', contactPhone })
    ));

    expect(results.every((result) => result.success)).toBe(true);
  });

  it('emits stable translation keys for client-side field validation', () => {
    const required = vendorRegisterSchema.safeParse({});
    expect(required.success).toBe(false);
    if (!required.success) {
      expect(required.error.issues.find((issue) => issue.path[0] === 'name')?.message).toBe('registration.validation.name.required');
    }

    const invalidFormats = vendorRegisterSchema.safeParse({
      name: 'Valid Vendor',
      contactEmail: 'not-an-email',
      logoUrl: 'not-a-url',
      coverUrl: 'also-not-a-url',
    });
    expect(invalidFormats.success).toBe(false);
    if (!invalidFormats.success) {
      expect(invalidFormats.error.issues.find((issue) => issue.path[0] === 'contactEmail')?.message).toBe('registration.validation.contactEmail.format');
      expect(invalidFormats.error.issues.find((issue) => issue.path[0] === 'logoUrl')?.message).toBe('registration.validation.logoUrl.format');
      expect(invalidFormats.error.issues.find((issue) => issue.path[0] === 'coverUrl')?.message).toBe('registration.validation.coverUrl.format');
    }
  });
});

describe('voucherCreateSchema', () => {
  const validVoucher = {
    code: 'TRAVEL10',
    name: 'Travel discount',
    voucherType: 'fixed' as const,
    discountValue: 10,
    minSpend: 20,
    validFrom: '2026-07-31T11:33:00.000Z',
    validUntil: '2026-08-23T11:29:00.000Z',
  };

  it('rejects an end date that is not after the start date', () => {
    const result = voucherCreateSchema.safeParse({
      ...validVoucher,
      validUntil: '2026-07-30T11:29:00.000Z',
    });

    expect(result.success).toBe(false);
  });
});

describe('voucherValidateSchema', () => {
  it('defaults validation intent to apply', () => {
    const result = voucherValidateSchema.safeParse({
      code: 'TRAVEL10',
      cartSubtotal: 100,
      intent: 'view',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.intent).toBe('view');
  });
});

describe('event listing schemas', () => {
  const listing = { price: 12.5, dailyQuantity: 20, itemKind: 'product' as const };

  it('requires price, daily quantity and type on every event item', () => {
    expect(campaignRegistrationProductSchema.safeParse({ kind: 'existing', productId: validId, ...listing }).success).toBe(true);
    expect(campaignRegistrationProductSchema.safeParse({ kind: 'new', name: 'Kuih lapis', imageUrl: null, ...listing, price: 0, itemKind: 'service' }).success).toBe(true);
    expect(campaignRegistrationProductSchema.safeParse({ kind: 'existing', productId: validId }).success).toBe(false);
  });

  it('rejects negative prices, fractional or oversized quantities and unknown types', () => {
    const base = { kind: 'existing', productId: validId, ...listing };
    expect(campaignRegistrationProductSchema.safeParse({ ...base, price: -1 }).success).toBe(false);
    expect(campaignRegistrationProductSchema.safeParse({ ...base, dailyQuantity: 1.5 }).success).toBe(false);
    expect(campaignRegistrationProductSchema.safeParse({ ...base, dailyQuantity: 10_001 }).success).toBe(false);
    expect(campaignRegistrationProductSchema.safeParse({ ...base, itemKind: 'ticket' }).success).toBe(false);
  });

  it('lets a vendor change only stock and on/off after submission', () => {
    expect(campaignListingUpdateSchema.safeParse({ dailyQuantity: 0, active: false }).success).toBe(true);
    expect(campaignListingUpdateSchema.safeParse({ dailyQuantity: 5, active: true, price: 1 }).success).toBe(false);
  });
});

describe('pickupSlotSchema', () => {
  const slot = { registrationId: validId, slotDate: null, startsAt: '10:00', endsAt: '11:30', capacity: 20 };

  it('accepts an every-day window and an extra window on one date', () => {
    expect(pickupSlotSchema.safeParse(slot).success).toBe(true);
    expect(pickupSlotSchema.safeParse({ ...slot, slotDate: '2026-10-05' }).success).toBe(true);
  });

  it('rejects windows that end before they start, bad times and bad limits', () => {
    expect(pickupSlotSchema.safeParse({ ...slot, endsAt: '09:00' }).success).toBe(false);
    expect(pickupSlotSchema.safeParse({ ...slot, startsAt: '25:00' }).success).toBe(false);
    expect(pickupSlotSchema.safeParse({ ...slot, capacity: 0 }).success).toBe(false);
    expect(pickupSlotSchema.safeParse({ ...slot, slotDate: '5/10/2026' }).success).toBe(false);
  });
});
