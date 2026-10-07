import { describe, expect, it } from 'vitest';
import { campaignLocationSchema } from '../validation';
import { campaignRegistrationReviewSchema } from '@/lib/validation/schemas';
import { campaignRegistrationSubmitSchema } from '@/lib/validation/vendor-schemas';

const location = { name: 'Main Hall', address: null, lat: null, lng: null,
  startsOn: '2026-11-01', endsOn: '2026-11-08', opensAt: '10:00', closesAt: '22:00',
  maxStalls: null, applicationsOpen: true, applicationsCloseAt: '2026-10-28T10:00:00Z',
  approvalsCloseAt: '2026-10-30T10:00:00Z', setupStartsAt: '2026-10-31T02:00:00Z' };

describe('event intake rules', () => {
  it('allows intake with unknown capacity and a valid preparation schedule', () => {
    expect(campaignLocationSchema.safeParse(location).success).toBe(true);
  });
  it('rejects an open intake without deadlines', () => {
    expect(campaignLocationSchema.safeParse({ ...location, applicationsCloseAt: null }).success).toBe(false);
  });
  it('compares first opening in Malaysia time, including the exact boundary', () => {
    expect(campaignLocationSchema.safeParse({ ...location, setupStartsAt: '2026-11-01T02:00:00Z' }).success).toBe(false);
  });
  it('rejects reversed deadlines and fractional or zero physical capacities', () => {
    expect(campaignLocationSchema.safeParse({ ...location, approvalsCloseAt: '2026-10-27T10:00:00Z' }).success).toBe(false);
    for (const maxStalls of [0, -1, 2.5]) expect(campaignLocationSchema.safeParse({ ...location, maxStalls }).success).toBe(false);
  });
  it('requires a confirmed booth and version token only for approval', () => {
    expect(campaignRegistrationReviewSchema.safeParse({ action: 'approve' }).success).toBe(false);
    expect(campaignRegistrationReviewSchema.safeParse({ action: 'approve', stallNumber: ' A12 ', expectedUpdatedAt: '2026-10-08T00:00:00Z' }).success).toBe(true);
    expect(campaignRegistrationReviewSchema.safeParse({ action: 'reject', note: 'Application declined' }).success).toBe(true);
  });
  it('allows vendors to leave the preferred booth blank', () => {
    const input = { stallNumber: '', stallDescription: 'Handmade Malaysian crafts',
      stallPosterUrl: 'https://example.test/poster.png', products: [{ kind: 'new', name: 'Handmade souvenir', imageUrl: null, price: 12, dailyQuantity: 10, itemKind: 'product' }] };
    expect(campaignRegistrationSubmitSchema.safeParse(input).success).toBe(true);
  });
});
