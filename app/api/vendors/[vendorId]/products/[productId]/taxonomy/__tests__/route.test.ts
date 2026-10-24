import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authorizeVendor: vi.fn(),
  from: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock('@/lib/vendor-authorization', () => ({ authorizeVendor: mocks.authorizeVendor }));
vi.mock('next/cache', () => ({ revalidateTag: mocks.revalidateTag }));

import { PATCH } from '../route';

const vendorId = 'vendor-1';
const productId = 'product-1';

function makeQuery(result: unknown) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    update: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
  };
  return query;
}

function ownerAccess() {
  return {
    ok: true,
    access: {
      userId: 'owner-1',
      vendorId,
      role: 'vendor_owner',
      outletIds: [],
      isOwner: true,
      isOutletManager: false,
      authDb: {},
      serviceDb: { from: mocks.from },
    },
  };
}

function request(body: unknown) {
  return new Request('http://localhost/api/vendors/vendor-1/products/product-1/taxonomy', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PATCH owner-only product taxonomy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorizeVendor.mockResolvedValue(ownerAccess());
  });

  it('updates only type_slugs without changing product review or publication state', async () => {
    const productQuery = makeQuery({ data: { id: productId, category_id: 'category-food' }, error: null });
    const categoryQuery = makeQuery({ data: { slug: 'food' }, error: null });
    const updateQuery = makeQuery({ data: { id: productId, type_slugs: ['malay'] }, error: null });
    mocks.from.mockReturnValueOnce(productQuery).mockReturnValueOnce(categoryQuery).mockReturnValueOnce(updateQuery);

    const response = await PATCH(request({ typeSlugs: ['malay'] }), {
      params: Promise.resolve({ vendorId, productId }),
    });

    expect(response.status).toBe(200);
    expect(mocks.authorizeVendor).toHaveBeenCalledWith(vendorId, ['vendor_owner']);
    expect(updateQuery.update).toHaveBeenCalledWith({ type_slugs: ['malay'] });
    expect(productQuery.eq).toHaveBeenCalledWith('vendor_id', vendorId);
    expect(productQuery.eq).toHaveBeenCalledWith('id', productId);
    expect(updateQuery.eq).toHaveBeenCalledWith('vendor_id', vendorId);
    expect(updateQuery.eq).toHaveBeenCalledWith('id', productId);
    expect(mocks.revalidateTag).toHaveBeenCalledWith('activities', { expire: 0 });
  });

  it('rejects type slugs that do not belong to the product category', async () => {
    const productQuery = makeQuery({ data: { id: productId, category_id: 'category-food' }, error: null });
    const categoryQuery = makeQuery({ data: { slug: 'food' }, error: null });
    mocks.from.mockReturnValueOnce(productQuery).mockReturnValueOnce(categoryQuery);

    const response = await PATCH(request({ typeSlugs: ['nature'] }), {
      params: Promise.resolve({ vendorId, productId }),
    });

    expect(response.status).toBe(422);
    expect(mocks.from).toHaveBeenCalledTimes(2);
    expect(mocks.revalidateTag).not.toHaveBeenCalled();
  });

  it('does not allow outlet managers to use the owner taxonomy endpoint', async () => {
    mocks.authorizeVendor.mockResolvedValue({ ok: false, response: new Response('Forbidden', { status: 403 }) });

    const response = await PATCH(request({ typeSlugs: ['malay'] }), {
      params: Promise.resolve({ vendorId, productId }),
    });

    expect(response.status).toBe(403);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('rejects additional product fields rather than widening the type-only endpoint', async () => {
    const response = await PATCH(request({ typeSlugs: ['malay'], basePrice: 1 }), {
      params: Promise.resolve({ vendorId, productId }),
    });

    expect(response.status).toBe(422);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
