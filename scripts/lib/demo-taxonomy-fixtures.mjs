export const DEMO_PRODUCT_TYPE_SLUGS_BY_CATEGORY = Object.freeze({
  food: Object.freeze(['chinese', 'malay', 'nyonya', 'indian', 'mamak', 'western', 'seafood', 'cafe-dessert', 'fusion']),
  activity: Object.freeze(['nature', 'adventure', 'cultural', 'nightlife', 'wellness', 'water', 'sightseeing']),
  retail: Object.freeze(['handicrafts', 'souvenirs', 'batik-textiles', 'fashion', 'jewellery', 'local-produce', 'art-prints', 'duty-free']),
});

export const DEMO_OUTLET_BADGE_SLUGS = Object.freeze(['hidden_gem', 'family_friendly', 'couple_friendly']);

const BASE_OUTLET_BADGES = Object.freeze({
  'rasa-bukit-bintang': ['family_friendly'],
  'rasa-klcc': ['couple_friendly'],
  'rasa-georgetown': ['hidden_gem', 'couple_friendly'],
  'rasa-batu-ferringhi': ['family_friendly', 'couple_friendly'],
  'rasa-jonker-walk': ['hidden_gem'],
  'rasa-kota-kinabalu': ['hidden_gem', 'family_friendly'],
  'rasa-kuching-waterfront': ['family_friendly'],
  'rasa-ipoh-old-town': ['hidden_gem', 'couple_friendly'],
  'rasa-langkawi': ['couple_friendly'],
  'rasa-johor-bahru': ['family_friendly'],
  'rasa-kota-bharu': ['hidden_gem'],
  'rasa-kuala-terengganu': ['family_friendly', 'couple_friendly'],
  'rasa-seremban': ['couple_friendly'],
});

const EXTRA_OUTLET_BADGES = Object.freeze({
  'batik-kuantan': ['hidden_gem'],
  'batik-kuala-terengganu': ['family_friendly'],
  'borneo-kota-kinabalu': ['hidden_gem', 'couple_friendly'],
  'borneo-sandakan': ['family_friendly', 'couple_friendly'],
});

export const DEMO_BASE_OUTLET_SLUGS = Object.freeze(Object.keys(BASE_OUTLET_BADGES));
export const DEMO_EXTRA_OUTLET_SLUGS = Object.freeze(Object.keys(EXTRA_OUTLET_BADGES));
export const DEMO_THEMED_VENDOR_SLUGS = Object.freeze([
  'explore-outdoors-malaysia',
  'warisan-cultural-journeys',
  'serenity-wellness-retreats',
  'kraftangan-artisan-market',
]);

const ALL_BADGE_SLUGS = new Set(DEMO_OUTLET_BADGE_SLUGS);
const ALL_PRODUCT_TYPE_SLUGS = new Set(Object.values(DEMO_PRODUCT_TYPE_SLUGS_BY_CATEGORY).flat());

export function demoOutletBadgeSlugs(outletSlug) {
  const direct = EXTRA_OUTLET_BADGES[outletSlug] ?? BASE_OUTLET_BADGES[outletSlug];
  if (direct) return [...direct];

  const baseSlug = Object.keys(BASE_OUTLET_BADGES).find((candidate) => outletSlug.endsWith(`-${candidate}`));
  if (baseSlug) return [...BASE_OUTLET_BADGES[baseSlug]];

  throw new Error(`Missing deterministic demo outlet badge fixture for ${outletSlug}`);
}

export function assertDemoProductType(categorySlug, typeSlugs, identity) {
  const allowed = DEMO_PRODUCT_TYPE_SLUGS_BY_CATEGORY[categorySlug];
  if (!allowed || typeSlugs.length === 0 || typeSlugs.some((slug) => !allowed.includes(slug))) {
    throw new Error(`Invalid or missing demo product type for ${identity} (${categorySlug}): ${typeSlugs.join(', ') || '(none)'}`);
  }
}

export function assertDemoOutletBadgeCoverage(outlets, { requireAll = true } = {}) {
  const seen = new Set();
  for (const outlet of outlets) {
    if (!outlet.badge_slugs?.length || outlet.badge_slugs.some((slug) => !ALL_BADGE_SLUGS.has(slug))) {
      throw new Error(`Invalid or missing demo outlet badges for ${outlet.slug}`);
    }
    outlet.badge_slugs.forEach((slug) => seen.add(slug));
  }
  if (requireAll) {
    for (const slug of DEMO_OUTLET_BADGE_SLUGS) {
      if (!seen.has(slug)) throw new Error(`Demo outlet badge fixture coverage is missing ${slug}`);
    }
  }
}

export function assertDemoProductTypeCatalogMatches(catalog) {
  for (const [categorySlug, expectedSlugs] of Object.entries(DEMO_PRODUCT_TYPE_SLUGS_BY_CATEGORY)) {
    const actualSlugs = catalog[categorySlug]?.types?.map(({ slug }) => slug) ?? [];
    if (actualSlugs.length !== expectedSlugs.length || expectedSlugs.some((slug) => !actualSlugs.includes(slug))) {
      throw new Error(`Demo product type fixture is out of sync with the ${categorySlug} catalog`);
    }
  }
  if (ALL_PRODUCT_TYPE_SLUGS.size !== Object.values(DEMO_PRODUCT_TYPE_SLUGS_BY_CATEGORY).flat().length) {
    throw new Error('Demo product type fixture contains duplicate type slugs');
  }
}
