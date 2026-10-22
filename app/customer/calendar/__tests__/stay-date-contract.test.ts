import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'app/customer/calendar/page.tsx'), 'utf8');

describe('customer calendar accommodation dates', () => {
  it('shows both check-in and check-out dates for one-night stays in the calendar and list', () => {
    expect(source).toContain('group.bookings[0]?.categorySlug === "accommodation"');
    expect(source).toContain('formatStayRange(group.slotStartsAt, group.bookings[0]?.nights ?? 1, locale)');
    expect(source.match(/group\.bookings\[0\]\?\.categorySlug === "accommodation"/g)).toHaveLength(2);
  });
});
