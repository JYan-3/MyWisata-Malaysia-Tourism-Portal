export const DEMO_PRODUCT_TYPE_SLUGS_BY_CATEGORY: Readonly<Record<string, readonly string[]>>;
export const DEMO_OUTLET_BADGE_SLUGS: readonly string[];
export const DEMO_BASE_OUTLET_SLUGS: readonly string[];
export const DEMO_EXTRA_OUTLET_SLUGS: readonly string[];
export const DEMO_THEMED_VENDOR_SLUGS: readonly string[];

export function demoOutletBadgeSlugs(outletSlug: string): string[];
export function assertDemoProductType(categorySlug: string, typeSlugs: string[], identity: string): void;
export function assertDemoOutletBadgeCoverage(
  outlets: { slug: string; badge_slugs?: string[] | null }[],
  options?: { requireAll?: boolean },
): void;
export function assertDemoProductTypeCatalogMatches(
  catalog: Record<string, { types?: { slug: string }[] }>,
): void;
