import { describe, expect, it, vi } from 'vitest';
import { getOutletStock, getScopedProduct, isInventoryConfiguredForOutlets, isRatingEligibleProduct, isVisibleActiveProduct, resolveProductOutlet } from '@/lib/vendor/product-scope';

describe('resolveProductOutlet', () => {
  it('keeps a shared product visible through an outlet offer in scope', () => {
    const result = resolveProductOutlet(
      {
        outlet_id: null,
        outlets: null,
        outlet_offers: [
          { outlet_id: 'outside', status: 'active', outlets: { id: 'outside', name: 'Outside' } },
          { outlet_id: 'assigned', status: 'active', outlets: { id: 'assigned', name: 'Assigned' } },
        ],
      },
      ['assigned'],
    );

    expect(result).toEqual({ id: 'assigned', name: 'Assigned' });
  });

  it('hides a shared product when none of its offers are in scope', () => {
    expect(resolveProductOutlet({ outlet_id: null, outlets: null, outlet_offers: [] }, ['assigned'])).toBeNull();
  });

  it('does not authorize a shared product through an inactive offer', () => {
    expect(resolveProductOutlet({
      outlet_id: null,
      outlets: null,
      outlet_offers: [{ outlet_id: 'assigned', status: 'inactive' }],
    }, ['assigned'])).toBeNull();
  });

  it('counts an active shared product when an assigned outlet has an active offer', () => {
    expect(isVisibleActiveProduct({
      status: 'active',
      outlet_id: null,
      outlets: null,
      outlet_offers: [{ outlet_id: 'assigned', status: 'active' }],
    }, ['assigned'])).toBe(true);
  });

  it('allows rated food listings to appear in the vendor ranking', () => {
    expect(isRatingEligibleProduct({
      status: 'active',
      outlet_id: null,
      outlets: null,
      outlet_offers: [{ outlet_id: 'assigned', status: 'active' }],
    }, ['assigned'])).toBe(true);
  });
});

describe('isInventoryConfiguredForOutlets', () => {
  it('requires an active variant and an inventory row for each outlet in scope', () => {
    expect(isInventoryConfiguredForOutlets([], ['outlet-1'])).toBe(false);
    expect(isInventoryConfiguredForOutlets([
      { is_active: true, inventory: [{ outlet_id: 'outlet-1', quantity: 0 }] },
    ], ['outlet-1'])).toBe(true);
    expect(isInventoryConfiguredForOutlets([
      { is_active: true, inventory: [{ outlet_id: 'outlet-1', quantity: 2 }] },
    ], ['outlet-1', 'outlet-2'])).toBe(false);
  });

  it('ignores inactive variants when checking whether configured active stock exists', () => {
    expect(isInventoryConfiguredForOutlets([
      { is_active: false, inventory: [] },
      { is_active: true, inventory: [{ outlet_id: 'outlet-1', quantity: 0 }] },
    ], ['outlet-1'])).toBe(true);
    expect(isInventoryConfiguredForOutlets([
      { is_active: false, inventory: [{ outlet_id: 'outlet-1', quantity: 5 }] },
    ], ['outlet-1'])).toBe(false);
  });

  it('does not treat an empty outlet scope as configured inventory', () => {
    expect(isInventoryConfiguredForOutlets([
      { is_active: true, inventory: [{ outlet_id: 'outlet-1', quantity: 5 }] },
    ], [])).toBe(false);
  });
});

describe('getOutletStock', () => {
  it('does not count inventory attached to an inactive variant as sellable stock', () => {
    expect(getOutletStock([
      { is_active: false, inventory: [{ outlet_id: 'outlet-1', quantity: 9, reserved: 0, low_stock_threshold: 2 }] },
      { is_active: true, inventory: [{ outlet_id: 'outlet-1', quantity: 3, reserved: 1, low_stock_threshold: 2 }] },
    ], ['outlet-1'])).toEqual({ availableStock: 2, lowStockThreshold: 2 });
  });
});


it('prunes other outlets from nested data before returning a shared product', async () => {
  const product = {
    outlet_id: null,
    outlet_offers: [{ outlet_id: 'assigned', status: 'active' }, { outlet_id: 'outside', status: 'active' }],
    product_variants: [{ id: 'variant', inventory: [{ outlet_id: 'outside', quantity: 999 }, { outlet_id: 'assigned', quantity: 2 }] }],
    booking_slots: [{ outlet_id: 'outside', id: 'private-slot' }, { outlet_id: 'assigned', id: 'visible-slot' }],
  };
  const query = { select: vi.fn(), eq: vi.fn(), or: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: product, error: null }) };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.or.mockReturnValue(query);
  const result = await getScopedProduct({ from: () => query } as never, 'vendor', 'product', ['assigned'], '*');
  expect(result.data?.outlet_offers).toEqual([{ outlet_id: 'assigned', status: 'active' }]);
  expect(result.data?.booking_slots).toEqual([{ outlet_id: 'assigned', id: 'visible-slot' }]);
  expect(result.data?.product_variants).toEqual([{ id: 'variant', inventory: [{ outlet_id: 'assigned', quantity: 2 }] }]);
  expect(product.booking_slots).toHaveLength(2);
});
