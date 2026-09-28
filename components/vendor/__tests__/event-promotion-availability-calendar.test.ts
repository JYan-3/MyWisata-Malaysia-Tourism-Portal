import { describe, expect, it } from 'vitest';
import { addDaysISO, toISODate } from '@/components/vendor/event-promotion-availability-calendar';

describe('toISODate', () => {
  it('never crosses a day boundary via UTC conversion — regression for the "day after also highlights" bug', () => {
    // A local-midnight Date for Oct 1 must stay Oct 1 regardless of the
    // runner's timezone. toISOString() would shift this back a day in any
    // timezone ahead of UTC (e.g. MYT/UTC+8) — that was the bug.
    expect(toISODate(new Date(2026, 9, 1))).toBe('2026-10-01');
    expect(toISODate(new Date(2026, 0, 1))).toBe('2026-01-01');
  });
});

describe('addDaysISO', () => {
  it('adds days without drifting across a month boundary', () => {
    expect(addDaysISO('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDaysISO('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('is a no-op for +0 days', () => {
    expect(addDaysISO('2026-09-30', 0)).toBe('2026-09-30');
  });
});
