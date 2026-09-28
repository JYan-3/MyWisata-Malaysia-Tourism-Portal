import { describe, expect, it } from 'vitest';
import { rankPersonalizedActivities, type PersonalizationReason } from '@/lib/personalization/scorer';
import type { ComputedActivity } from '@/backend/core/types';

const activity = (id: string, overrides: Partial<ComputedActivity> = {}): ComputedActivity => ({
  id,
  outletId: 'outlet-1',
  name: id,
  category: 'Food & Dining',
  description: 'A public activity description',
  image: '/image.jpg',
  price: 50,
  rating: 4.5,
  reviews: 10,
  duration: '2 hours',
  requiresBooking: false,
  variants: [],
  tags: [],
  outlet: { id: 'outlet-1', vendorId: 'vendor-1', name: 'Outlet', category: 'Food & Dining', state: 'Kuala Lumpur', city: 'Kuala Lumpur', address: 'Public address', lat: 3.1, lng: 101.6, hours: 'Daily', verified: true, open: true, rating: 4.5, reviews: 10 },
  ...overrides,
});

const codes = (reasons: PersonalizationReason[]) => reasons.map((r) => r.code).sort();

describe('rankPersonalizedActivities — grounded reasons', () => {
  it('emits an interest reason naming the matched category, only when it matched', () => {
    const [ranked] = rankPersonalizedActivities(
      [activity('food-tour', { tags: ['food'], price: 50 })],
      { interests: ['food'], budgetRange: 'budget', mobilityNeeds: 'none', preferredRadiusKm: 0 },
    );
    const interest = ranked.reasons.find((r) => r.code === 'interest');
    expect(interest).toEqual({ code: 'interest', category: 'food' });
  });

  it('does not emit an interest reason when no interest matched', () => {
    const [ranked] = rankPersonalizedActivities(
      [activity('museum', { category: 'Heritage', description: 'history', tags: [] })],
      { interests: ['food'], budgetRange: 'budget', mobilityNeeds: 'none', preferredRadiusKm: 0 },
    );
    expect(ranked.reasons.some((r) => r.code === 'interest')).toBe(false);
  });

  it('emits a budget reason only when the price falls in the selected band', () => {
    const [inBand] = rankPersonalizedActivities(
      [activity('cheap', { price: 50 })],
      { interests: [], budgetRange: 'budget', mobilityNeeds: 'none', preferredRadiusKm: 0 },
    );
    expect(inBand.reasons.some((r) => r.code === 'budget')).toBe(true);

    const [outOfBand] = rankPersonalizedActivities(
      [activity('pricey', { price: 250 })],
      { interests: [], budgetRange: 'budget', mobilityNeeds: 'none', preferredRadiusKm: 0 },
    );
    expect(outOfBand.reasons.some((r) => r.code === 'budget')).toBe(false);
  });

  it('emits a nearby reason with the real distance when within the radius', () => {
    const [ranked] = rankPersonalizedActivities(
      [activity('close', { distanceKm: 2.4, price: 999 })],
      { interests: [], budgetRange: 'budget', mobilityNeeds: 'none', preferredRadiusKm: 5 },
    );
    expect(ranked.reasons).toContainEqual({ code: 'nearby', distanceKm: 2.4 });
  });

  it('emits an accessible reason when a mobility preference matches the listing', () => {
    const [ranked] = rankPersonalizedActivities(
      [activity('accessible', { tags: ['wheelchair accessible'], price: 999 })],
      { interests: [], budgetRange: 'budget', mobilityNeeds: 'wheelchair', preferredRadiusKm: 0 },
    );
    expect(ranked.reasons.some((r) => r.code === 'accessible')).toBe(true);
  });

  it('stacks every reason that fired', () => {
    const [ranked] = rankPersonalizedActivities(
      [activity('all', { tags: ['food', 'wheelchair'], price: 50, distanceKm: 1 })],
      { interests: ['food'], budgetRange: 'budget', mobilityNeeds: 'wheelchair', preferredRadiusKm: 5 },
    );
    expect(codes(ranked.reasons)).toEqual(['accessible', 'budget', 'interest', 'nearby']);
  });
});
