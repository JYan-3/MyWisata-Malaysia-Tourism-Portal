import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ authorizeVendor: vi.fn(), from: vi.fn() }));

vi.mock('@/lib/vendor-authorization', () => ({
  authorizeVendor: mocks.authorizeVendor,
  authorizeVendorProductWrite: mocks.authorizeVendor,
}));
vi.mock('@/backend/domains/catalogue', () => ({ getOutletProductIds: vi.fn() }));

import { POST } from '../route';

const vendorId = 'b162faca-1400-4fe2-aab8-441934862b02';
const outletId = 'c64a457a-d4a7-4432-91b8-c9786683283e';
const productId = 'd7a1f5fb-716a-4b4c-bd0d-288b51d88d63';

type Result = { data?: unknown; error?: { message: string } | null };

function query(result: Result, options: { captureInsert?: (value: unknown) => void } = {}) {
  const builder: Record<string, unknown> = {
    delete: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    insert: vi.fn((value: unknown) => {
      options.captureInsert?.(value);
      return builder;
    }),
    select: vi.fn(() => builder),
    single: vi.fn().mockResolvedValue(result),
    then: (resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

function setup(failAt?: 'media_assets' | 'product_variants' | 'inventory') {
  const productInsert = query({ data: { id: productId, status: 'inactive', review_status: 'pending_review' } });
  const productDelete = query({ data: null, error: null });
  const vendorQuery = query({ data: { id: vendorId, owner_id: 'owner-1', status: 'approved' } });
  const outletQuery = query({ data: { id: outletId } });
  const mediaQuery = query({ error: failAt === 'media_assets' ? { message: 'media insert failed' } : null });
  const variantQuery = query({
    data: failAt === 'product_variants' ? null : { id: 'variant-1' },
    error: failAt === 'product_variants' ? { message: 'variant insert failed' } : null,
  });
  const inventoryQuery = query({ error: failAt === 'inventory' ? { message: 'inventory insert failed' } : null });
  let productCalls = 0;
  const db = {
    from: vi.fn((table: string) => {
      if (table === 'vendors') return vendorQuery;
      if (table === 'outlets') return outletQuery;
      if (table === 'products') return productCalls++ === 0 ? productInsert : productDelete;
      if (table === 'media_assets') return mediaQuery;
      if (table === 'product_variants') return variantQuery;
      if (table === 'inventory') return inventoryQuery;
      throw new Error(`Unexpected table ${table}`);
    }),
  };

  mocks.authorizeVendor.mockResolvedValue({
    ok: true,
    access: { outletIds: [outletId], serviceDb: db },
  });
  mocks.from.mockImplementation(db.from);

  return { db, productDelete };
}

async function createProduct(gallery = false) {
  const body = {
    name: 'QA outlet integration product',
    productType: 'product',
    requiresBooking: false,
    basePrice: 12.5,
    availableStock: 3,
    outletId,
    ...(gallery ? { gallery: [{ url: 'https://example.com/qa-product.jpg', alt: 'QA product' }] } : {}),
  };

  return POST(
    new Request(`http://localhost/api/vendors/${vendorId}/products`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ vendorId }) },
  );
}

describe('POST /api/vendors/:vendorId/products child writes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(['media_assets', 'product_variants', 'inventory'] as const)(
    'does not report success and removes the incomplete product when %s creation fails',
    async (failedTable) => {
      const { db, productDelete } = setup(failedTable);

      const response = await createProduct(failedTable === 'media_assets');

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toMatchObject({
        data: null,
        error: { code: 'DB_ERROR' },
      });
      expect(db.from).toHaveBeenCalledWith('products');
      expect(productDelete.delete).toHaveBeenCalledOnce();
      expect(productDelete.eq).toHaveBeenCalledWith('id', productId);
    },
  );

  it('keeps new products inactive and pending review until the existing approval flow publishes them', async () => {
    const { db } = setup();
    let productPayload: Record<string, unknown> | undefined;
    const productInsert = query(
      { data: { id: productId, status: 'inactive', review_status: 'pending_review' } },
      { captureInsert: (value) => { productPayload = value as Record<string, unknown>; } },
    );
    const productDelete = query({ data: null, error: null });
    let productCalls = 0;
    db.from.mockImplementation((table: string) => {
      if (table === 'vendors') return query({ data: { id: vendorId, status: 'approved' } });
      if (table === 'outlets') return query({ data: { id: outletId } });
      if (table === 'products') return productCalls++ === 0 ? productInsert : productDelete;
      if (table === 'media_assets') return query({ error: null });
      if (table === 'product_variants') return query({ data: { id: 'variant-1' }, error: null });
      if (table === 'inventory') return query({ error: null });
      throw new Error(`Unexpected table ${table}`);
    });
    mocks.from.mockImplementation(db.from);

    const response = await createProduct();

    expect(response.status).toBe(201);
    expect(productPayload).toMatchObject({ outlet_id: outletId, status: 'inactive', review_status: 'pending_review' });
  });
});
