import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATEGORY_DETAILS } from '@/lib/customer/category-details';
import {
  assertDemoOutletBadgeCoverage,
  assertDemoProductType,
  assertDemoProductTypeCatalogMatches,
  DEMO_BASE_OUTLET_SLUGS,
  DEMO_EXTRA_OUTLET_SLUGS,
  DEMO_OUTLET_BADGE_SLUGS,
  DEMO_THEMED_VENDOR_SLUGS,
  demoOutletBadgeSlugs,
} from '../lib/demo-taxonomy-fixtures.mjs';

describe('deterministic vendor taxonomy demo fixtures', () => {
  it('stays aligned with the approved product type options', () => {
    expect(() => assertDemoProductTypeCatalogMatches(CATEGORY_DETAILS)).not.toThrow();
  });

  it('assigns non-empty controlled badges to every seeded base, themed, and extra outlet', () => {
    const slugs = [
      ...DEMO_BASE_OUTLET_SLUGS,
      ...DEMO_EXTRA_OUTLET_SLUGS,
      ...DEMO_THEMED_VENDOR_SLUGS.flatMap((vendorSlug) => DEMO_BASE_OUTLET_SLUGS.map((outletSlug) => `${vendorSlug}-${outletSlug}`)),
    ];
    const outlets = slugs.map((slug) => ({ slug, badge_slugs: demoOutletBadgeSlugs(slug) }));

    expect(() => assertDemoOutletBadgeCoverage(outlets)).not.toThrow();
    expect(new Set(outlets.flatMap(({ badge_slugs }) => badge_slugs))).toEqual(new Set(DEMO_OUTLET_BADGE_SLUGS));
    expect(demoOutletBadgeSlugs('rasa-klcc')).toEqual(demoOutletBadgeSlugs('rasa-klcc'));
  });

  it('gives the shared Serenity products different badges at their three branches', () => {
    const kl = demoOutletBadgeSlugs('serenity-wellness-retreats-rasa-klcc');
    const georgetown = demoOutletBadgeSlugs('serenity-wellness-retreats-rasa-georgetown');
    const kotaKinabalu = demoOutletBadgeSlugs('serenity-wellness-retreats-rasa-kota-kinabalu');

    expect(new Set([JSON.stringify(kl), JSON.stringify(georgetown), JSON.stringify(kotaKinabalu)]).size).toBe(3);
  });

  it('rejects an invalid or missing demo product type before a seed write', () => {
    expect(() => assertDemoProductType('activity', ['nature'], 'forest walk')).not.toThrow();
    expect(() => assertDemoProductType('activity', [], 'untyped walk')).toThrow(/Invalid or missing demo product type/);
    expect(() => assertDemoProductType('food', ['nature'], 'misclassified product')).toThrow(/Invalid or missing demo product type/);
  });

  it('keeps every remote-demo product seed path behind the taxonomy checks and does not write legacy badge booleans', () => {
    const seed = readFileSync(resolve(process.cwd(), 'scripts/seed-remote-demo.mjs'), 'utf8');

    expect(seed).toContain("assertDemoProductType(CATEGORIES[categoryIndex][2], productTypeSlugs, slug)");
    expect(seed).toContain("assertDemoProductType('activity', product.type_slugs, product.slug)");
    expect(seed).toContain("demoOutletBadgeSlugs(`${tv.slug}-${slug}`)");
    expect(seed).not.toContain('is_family_friendly:');
  });
});
