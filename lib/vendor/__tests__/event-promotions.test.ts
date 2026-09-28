import { describe, expect, it } from 'vitest';
import { computeEventPromotionAmountSen } from '@/lib/vendor/event-promotions';

describe('computeEventPromotionAmountSen', () => {
  it('charges for a single day at RM100/day (1-day inclusive range)', () => {
    expect(computeEventPromotionAmountSen('2027-01-15', '2027-01-15', 10_000)).toBe(10_000);
  });

  it('charges inclusively for a multi-day range', () => {
    // Jan 15 - Jan 17 inclusive = 3 days.
    expect(computeEventPromotionAmountSen('2027-01-15', '2027-01-17', 10_000)).toBe(30_000);
  });

  it('scales linearly with the configured cost per day', () => {
    expect(computeEventPromotionAmountSen('2027-01-15', '2027-01-17', 25_000)).toBe(75_000);
  });
});
