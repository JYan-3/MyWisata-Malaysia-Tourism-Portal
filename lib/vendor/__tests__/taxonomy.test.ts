import { describe, expect, it } from 'vitest';
import { CATEGORY_DETAILS } from '@/lib/customer/category-details';
import { isValidOutletTaxonomySelection, isValidProductTypeSelection } from '@/lib/vendor/taxonomy';

describe('vendor-managed taxonomy', () => {
  it('accepts type slugs only from the selected food, activity, or retail category', () => {
    expect(isValidProductTypeSelection('food', ['nyonya', 'seafood'])).toBe(true);
    expect(isValidProductTypeSelection('activity', ['nature'])).toBe(true);
    expect(isValidProductTypeSelection('retail', ['souvenirs'])).toBe(true);
    expect(isValidProductTypeSelection('food', ['nature'])).toBe(false);
    expect(isValidProductTypeSelection('accommodation', ['resort'])).toBe(false);
    expect(isValidProductTypeSelection('retail', ['shopping-mall'])).toBe(false);
  });

  it('accepts outlet badges and limits property types to accommodation outlets', () => {
    expect(isValidOutletTaxonomySelection({ badgeSlugs: ['hidden_gem', 'family_friendly'], accommodationTypeSlugs: [], isAccommodationOutlet: false })).toBe(true);
    expect(isValidOutletTaxonomySelection({ badgeSlugs: ['made_up'], accommodationTypeSlugs: [], isAccommodationOutlet: false })).toBe(false);
    expect(isValidOutletTaxonomySelection({ badgeSlugs: [], accommodationTypeSlugs: ['boutique'], isAccommodationOutlet: true })).toBe(true);
    expect(isValidOutletTaxonomySelection({ badgeSlugs: [], accommodationTypeSlugs: ['boutique'], isAccommodationOutlet: false })).toBe(false);
  });

  it('keeps retail venue types out of the vendor-managed product taxonomy', () => {
    const retailTypes = CATEGORY_DETAILS.retail.types.map(({ slug }) => slug);
    expect(retailTypes).not.toContain('shopping-mall');
    expect(retailTypes).not.toContain('market-bazaar');
  });
});
