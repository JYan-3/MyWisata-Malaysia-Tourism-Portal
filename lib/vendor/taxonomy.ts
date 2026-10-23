import { CATEGORY_DETAILS } from '@/lib/customer/category-details';

export const OUTLET_BADGE_OPTIONS = [
  { slug: 'hidden_gem', labelKey: 'hiddenGem' },
  { slug: 'family_friendly', labelKey: 'familyFriendly' },
  { slug: 'couple_friendly', labelKey: 'coupleFriendly' },
] as const;

export const PRODUCT_TYPE_CATEGORY_SLUGS = ['food', 'activity', 'retail'] as const;

export const PRODUCT_TYPE_SLUGS = [...new Set(
  PRODUCT_TYPE_CATEGORY_SLUGS.flatMap((category) => CATEGORY_DETAILS[category].types.map(({ slug }) => slug)),
)];

export const ACCOMMODATION_PROPERTY_TYPES = CATEGORY_DETAILS.accommodation.types;

export const OUTLET_BADGE_SLUGS: string[] = OUTLET_BADGE_OPTIONS.map(({ slug }) => slug);
export const ACCOMMODATION_PROPERTY_TYPE_SLUGS: string[] = ACCOMMODATION_PROPERTY_TYPES.map(({ slug }) => slug);

export const isProductTypeSlug = (value: string) => PRODUCT_TYPE_SLUGS.includes(value);
export const isOutletBadgeSlug = (value: string) => OUTLET_BADGE_SLUGS.includes(value);
export const isAccommodationPropertyTypeSlug = (value: string) => ACCOMMODATION_PROPERTY_TYPE_SLUGS.includes(value);

export function isValidProductTypeSelection(categorySlug: string | null | undefined, slugs: string[]): boolean {
  if (slugs.length === 0) return true;
  if (!categorySlug || !PRODUCT_TYPE_CATEGORY_SLUGS.includes(categorySlug as (typeof PRODUCT_TYPE_CATEGORY_SLUGS)[number])) return false;
  const allowedSlugs = new Set(CATEGORY_DETAILS[categorySlug].types.map(({ slug }) => slug));
  return new Set(slugs).size === slugs.length && slugs.every((slug) => allowedSlugs.has(slug));
}

export function isValidOutletTaxonomySelection(input: {
  badgeSlugs: string[];
  accommodationTypeSlugs: string[];
  isAccommodationOutlet: boolean;
}): boolean {
  const badgeSlugs = new Set<string>(OUTLET_BADGE_SLUGS);
  const propertyTypeSlugs = new Set<string>(ACCOMMODATION_PROPERTY_TYPE_SLUGS);
  return new Set(input.badgeSlugs).size === input.badgeSlugs.length
    && input.badgeSlugs.every((slug) => badgeSlugs.has(slug))
    && new Set(input.accommodationTypeSlugs).size === input.accommodationTypeSlugs.length
    && input.accommodationTypeSlugs.every((slug) => propertyTypeSlugs.has(slug))
    && (input.isAccommodationOutlet || input.accommodationTypeSlugs.length === 0);
}
