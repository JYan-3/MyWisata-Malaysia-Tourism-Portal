import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ authorizeVendor: vi.fn(), from: vi.fn(), getOutletProductIds: vi.fn() }));

vi.mock('@/lib/vendor-authorization', () => ({ authorizeVendor: mocks.authorizeVendor }));
vi.mock('@/backend/domains/catalogue', () => ({ getOutletProductIds: mocks.getOutletProductIds }));

import { GET } from '../route';

function chainQuery(result: unknown) {
  const query = {
    contains: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    or: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
    select: vi.fn(),
  };
  for (const method of ['contains', 'eq', 'in', 'or', 'range', 'select'] as const) {
    query[method].mockReturnValue(query);
  }
  query.order.mockResolvedValue(result);
  return query;
}

describe('GET /api/vendors/:vendorId/products review-state filter', () => {
  it('applies review_status in the authorized product query and preserves pagination metadata', async () => {
    const productQuery = chainQuery({
      count: 27,
      data: [{
        id: 'approved-product',
        name: 'Approved product',
        base_price: 10,
        outlet_id: 'outlet-a',
        outlets: { id: 'outlet-a', name: 'Outlet A' },
        outlet_offers: [],
        product_variants: [],
        requires_booking: false,
        review_status: 'approved',
        status: 'active',
        tags: [],
      }],
      error: null,
    });
    const metricsQuery = {
      in: vi.fn().mockResolvedValue({ data: [] }),
      select: vi.fn().mockReturnThis(),
    };
    mocks.authorizeVendor.mockResolvedValue({
      access: { outletIds: ['outlet-a'], serviceDb: { from: mocks.from } },
      ok: true,
    });
    mocks.getOutletProductIds.mockResolvedValue(new Set(['approved-product']));
    mocks.from.mockImplementation((table: string) => table === 'products' ? productQuery : metricsQuery);

    const response = await GET(
      new Request('http://localhost/api/vendors/vendor-a/products?status=active&review_status=approved&page=2&pageSize=24'),
      { params: Promise.resolve({ vendorId: 'vendor-a' }) },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.items.map((item: { id: string }) => item.id)).toEqual(['approved-product']);
    expect(payload.data.pagination).toMatchObject({ page: 2, pageSize: 24, total: 27, totalPages: 2 });
    expect(productQuery.eq).toHaveBeenCalledWith('vendor_id', 'vendor-a');
    expect(productQuery.eq).toHaveBeenCalledWith('status', 'active');
    expect(productQuery.eq).toHaveBeenCalledWith('review_status', 'approved');
    expect(productQuery.range).toHaveBeenCalledWith(24, 47);
  });

  it('includes shared products offered at an assigned outlet even when their primary outlet is elsewhere', async () => {
    const sharedProduct = {
      id: 'shared-product',
      name: 'Shared attraction',
      base_price: 18,
      outlet_id: 'primary-outlet',
      outlets: { id: 'primary-outlet', name: 'Primary outlet' },
      outlet_offers: [
        {
          outlet_id: 'assigned-outlet',
          price: 18,
          status: 'active',
          outlets: { id: 'assigned-outlet', name: 'Assigned outlet' },
        },
      ],
      product_variants: [],
      requires_booking: false,
      status: 'active',
      tags: [],
    };
    const productQuery = chainQuery({ count: 1, data: [sharedProduct], error: null });
    const metricsQuery = {
      in: vi.fn().mockResolvedValue({ data: [] }),
      select: vi.fn().mockReturnThis(),
    };
    const db = { from: mocks.from };
    mocks.authorizeVendor.mockResolvedValue({
      access: { outletIds: ['assigned-outlet'], serviceDb: db },
      ok: true,
    });
    mocks.getOutletProductIds.mockResolvedValue(new Set(['shared-product']));
    mocks.from.mockImplementation((table: string) => table === 'products' ? productQuery : metricsQuery);

    const response = await GET(
      new Request('http://localhost/api/vendors/vendor-a/products'),
      { params: Promise.resolve({ vendorId: 'vendor-a' }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { items: [{ id: 'shared-product', outlet: { id: 'assigned-outlet' } }] },
    });
    expect(mocks.getOutletProductIds).toHaveBeenCalledWith(db, ['assigned-outlet']);
    expect(productQuery.in).toHaveBeenCalledWith('id', ['shared-product']);
    expect(productQuery.or).not.toHaveBeenCalled();
  });

  it('returns narrow listing metadata without querying review aggregates', async () => {
    const productQuery = chainQuery({
      count: 1,
      data: [{
        id: 'listing-product',
        name: 'Local craft workshop',
        base_price: 45,
        outlet_id: null,
        outlets: null,
        outlet_offers: [
          { outlet_id: 'outlet-private', price: 5, status: 'active', outlets: { id: 'outlet-private', name: 'Private outlet' } },
          { outlet_id: 'outlet-a', price: 39, status: 'active', outlets: { id: 'outlet-a', name: 'Outlet A' } },
        ],
        categories: { name: 'Crafts', slug: 'crafts' },
        requires_booking: true,
        review_status: 'approved',
        status: 'active',
      }],
      error: null,
    });
    mocks.authorizeVendor.mockResolvedValue({
      access: { outletIds: ['outlet-a'], serviceDb: { from: mocks.from } },
      ok: true,
    });
    mocks.getOutletProductIds.mockResolvedValue(new Set(['listing-product']));
    mocks.from.mockImplementation((table: string) => {
      if (table !== 'products') throw new Error(`Unexpected table read: ${table}`);
      return productQuery;
    });
    mocks.from.mockClear();

    const response = await GET(
      new Request('http://localhost/api/vendors/vendor-a/products?view=listing_metadata&status=active&review_status=approved'),
      { params: Promise.resolve({ vendorId: 'vendor-a' }) },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.items).toEqual([{
      id: 'listing-product',
      name: 'Local craft workshop',
      outlet_id: 'outlet-a',
      outlet: { id: 'outlet-a', name: 'Outlet A' },
      category: 'Crafts',
      requires_booking: true,
      price: 39,
    }]);
    expect(productQuery.select.mock.calls[0][0]).toContain('categories(name,slug)');
    expect(productQuery.select.mock.calls[0][0]).not.toContain('product_variants');
    expect(productQuery.eq).toHaveBeenCalledWith('status', 'active');
    expect(productQuery.eq).toHaveBeenCalledWith('review_status', 'approved');
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });
});
