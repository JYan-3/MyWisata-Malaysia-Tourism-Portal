import { describe, expect, it } from 'vitest';
import { buildProductFormDefaults } from '@/lib/vendor/product-form-helpers';

describe('buildProductFormDefaults inventory configuration', () => {
  it('leaves stock blank for an unconfigured legacy listing instead of suggesting zero', () => {
    const defaults = buildProductFormDefaults({
      id: 'legacy-product',
      productType: 'food',
      availableStock: 0,
      lowStockThreshold: 5,
      inventoryConfigured: false,
    });

    expect(defaults.availableStock).toBeUndefined();
    expect(defaults.lowStockThreshold).toBeUndefined();
  });

  it('keeps the actual quantity and threshold for a configured single-stock listing', () => {
    const defaults = buildProductFormDefaults({
      id: 'configured-product',
      productType: 'food',
      availableStock: 12,
      lowStockThreshold: 4,
      inventoryConfigured: true,
    });

    expect(defaults.availableStock).toBe(12);
    expect(defaults.lowStockThreshold).toBe(4);
  });
});
