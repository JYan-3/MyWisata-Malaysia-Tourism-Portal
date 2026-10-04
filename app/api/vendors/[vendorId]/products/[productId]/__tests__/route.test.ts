import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authorizeVendor: vi.fn(),
  from: vi.fn(),
}));

vi.mock('@/lib/vendor-authorization', () => ({ authorizeVendor: mocks.authorizeVendor, authorizeVendorProductWrite: mocks.authorizeVendor }));

import { PATCH } from '../route';
import { GET as GETVariants } from '../variants/route';

const vendorId = 'vendor-1';
const productId = 'product-shared';
const assignedOutletId = 'outlet-assigned';

function access() {
  return {
    ok: true,
    access: {
      userId: 'user-1',
      vendorId,
      role: 'outlet_manager',
      outletIds: [assignedOutletId],
      isOwner: false,
      isOutletManager: true,
      authDb: {},
      serviceDb: { from: mocks.from },
    },
  };
}

describe('PATCH vendor product shared outlet scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorizeVendor.mockResolvedValue(access());

    const productQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockImplementation(() => {
        productQuery.maybeSingle.mockResolvedValue({ data: null, error: null });
        return productQuery;
      }),
      or: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: productId,
          outlet_id: null,
          outlet_offers: [{ outlet_id: assignedOutletId, status: 'active' }],
        },
        error: null,
      }),
    };
    const updateQuery = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: productId, status: 'active' }, error: null }),
    };
    mocks.from.mockImplementation((table: string) => table === 'products' && mocks.from.mock.calls.length === 1 ? productQuery : updateQuery);
  });

  it('restores a shared product through its active outlet offer', async () => {
    const response = await PATCH(
      new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ status: 'active' }) }),
      { params: Promise.resolve({ vendorId, productId }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.from).toHaveBeenCalledWith('products');
  });

  it('persists draft content with a draft review status', async () => {
    let updatePayload: Record<string, unknown> | undefined;
    const updateQuery = {
      update: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
        updatePayload = payload;
        return updateQuery;
      }),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: productId, review_status: 'draft', status: 'inactive' }, error: null }),
    };
    const productQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: productId, outlet_id: null, outlet_offers: [{ outlet_id: assignedOutletId, status: 'active' }] },
        error: null,
      }),
    };
    mocks.from.mockImplementationOnce(() => productQuery).mockImplementationOnce(() => updateQuery);

    const response = await PATCH(
      new Request('http://localhost', {
        method: 'PATCH',
        body: JSON.stringify({
          name: 'Draft chicken rice',
          description: 'Updated draft description',
          productType: 'food',
          requiresBooking: false,
          basePrice: 24,
          coverUrl: 'https://example.com/chicken-rice.jpg',
          submissionMode: 'draft',
        }),
      }),
      { params: Promise.resolve({ vendorId, productId }) },
    );

    expect(response.status).toBe(200);
    expect(updatePayload).toMatchObject({ review_status: 'draft', status: 'inactive' });
  });

  it('persists a multi-entry admission policy with its visit limit and validity', async () => {
    let updatePayload: Record<string, unknown> | undefined;
    const updateQuery = {
      update: vi.fn().mockImplementation((payload: Record<string, unknown>) => {
        updatePayload = payload;
        return updateQuery;
      }),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: productId }, error: null }),
    };
    const productQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: productId,
          outlet_id: null,
          requires_booking: true,
          ticket_entry_policy: 'single_entry',
          ticket_entry_limit: 1,
          ticket_validity_days: null,
          outlet_offers: [{ outlet_id: assignedOutletId, status: 'active' }],
        },
        error: null,
      }),
    };
    mocks.from.mockImplementationOnce(() => productQuery).mockImplementationOnce(() => updateQuery);

    const response = await PATCH(
      new Request('http://localhost', {
        method: 'PATCH',
        body: JSON.stringify({
          requiresBooking: true,
          ticketEntryPolicy: 'multi_entry',
          ticketEntryLimit: 5,
          ticketValidityDays: 30,
        }),
      }),
      { params: Promise.resolve({ vendorId, productId }) },
    );

    expect(response.status).toBe(200);
    expect(updatePayload).toMatchObject({
      ticket_entry_policy: 'multi_entry',
      ticket_entry_limit: 5,
      ticket_validity_days: 30,
    });
  });

  it('creates outlet-scoped Standard inventory for a legacy product only after stock is entered', async () => {
    const callCounts = new Map<string, number>();
    let variantPayload: Record<string, unknown> | undefined;
    let inventoryPayload: Record<string, unknown> | undefined;
    const product = {
      id: productId,
      outlet_id: null,
      product_type: 'food',
      requires_booking: false,
      ticket_entry_policy: 'single_entry',
      ticket_entry_limit: 1,
      ticket_validity_days: null,
      review_status: 'approved',
      status: 'active',
      outlet_offers: [{ outlet_id: assignedOutletId, status: 'active' }],
    };
    const productScopeQuery = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), or: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: product, error: null }),
    };
    const productUpdateQuery = {
      update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: product, error: null }),
    };
    const productStatusQuery = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: product, error: null }),
    };
    const productStatusUpdate = {
      update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), neq: vi.fn().mockResolvedValue({ error: null }),
    };
    const noDefaultVariantQuery = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    const variantInsertQuery = {
      insert: vi.fn().mockImplementation((payload) => { variantPayload = payload; return variantInsertQuery; }),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'variant-created' }, error: null }),
    };
    const statusVariantsQuery = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockResolvedValue({
        data: [{ is_active: true, inventory: [{ quantity: 7, reserved: 0 }] }], error: null,
      }),
    };
    const inventoryQuery = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      upsert: vi.fn().mockImplementation((payload) => { inventoryPayload = payload; return Promise.resolve({ error: null }); }),
    };

    mocks.from.mockImplementation((table: string) => {
      const call = callCounts.get(table) ?? 0;
      callCounts.set(table, call + 1);
      if (table === 'products') return [productScopeQuery, productUpdateQuery, productStatusQuery, productStatusUpdate][call];
      if (table === 'product_variants') return [noDefaultVariantQuery, variantInsertQuery, statusVariantsQuery][call];
      if (table === 'inventory') return inventoryQuery;
      throw new Error(`Unexpected table ${table}`);
    });

    const response = await PATCH(
      new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ availableStock: 7 }) }),
      { params: Promise.resolve({ vendorId, productId }) },
    );

    expect(response.status).toBe(200);
    expect(variantPayload).toMatchObject({ product_id: productId, name: 'Standard', is_default: true });
    expect(inventoryPayload).toMatchObject({ variant_id: 'variant-created', outlet_id: assignedOutletId, quantity: 7 });
  });

  it('does not invent stock or create a variant when the quantity is omitted', async () => {
    const productQuery = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), or: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: {
        id: productId, outlet_id: null, product_type: 'food', requires_booking: false,
        ticket_entry_policy: 'single_entry', ticket_entry_limit: 1, ticket_validity_days: null,
        outlet_offers: [{ outlet_id: assignedOutletId, status: 'active' }],
      }, error: null }),
    };
    const updateQuery = {
      update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: productId }, error: null }),
    };
    mocks.from.mockImplementationOnce(() => productQuery).mockImplementationOnce(() => updateQuery);

    const response = await PATCH(
      new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ description: 'Updated description' }) }),
      { params: Promise.resolve({ vendorId, productId }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.from).toHaveBeenCalledTimes(2);
  });

  it('updates only the alert threshold when an inventory row already exists', async () => {
    let inventoryUpdate: Record<string, unknown> | undefined;
    const product = {
      id: productId, outlet_id: null, product_type: 'food', requires_booking: false,
      ticket_entry_policy: 'single_entry', ticket_entry_limit: 1, ticket_validity_days: null,
      outlet_offers: [{ outlet_id: assignedOutletId, status: 'active' }],
    };
    const productScopeQuery = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), or: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: product, error: null }),
    };
    const productUpdateQuery = {
      update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: product, error: null }),
    };
    const variantQuery = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'variant-existing' }, error: null }),
    };
    const inventoryQuery = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { quantity: 17, reserved: 3, low_stock_threshold: 5 }, error: null }),
      update: vi.fn().mockImplementation((payload) => { inventoryUpdate = payload; return inventoryQuery; }),
    };
    const callCounts = new Map<string, number>();
    mocks.from.mockImplementation((table: string) => {
      const call = callCounts.get(table) ?? 0;
      callCounts.set(table, call + 1);
      if (table === 'products') return [productScopeQuery, productUpdateQuery][call];
      if (table === 'product_variants') return variantQuery;
      if (table === 'inventory') return inventoryQuery;
      throw new Error(`Unexpected table ${table}`);
    });

    const response = await PATCH(
      new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ lowStockThreshold: 2 }) }),
      { params: Promise.resolve({ vendorId, productId }) },
    );

    expect(response.status).toBe(200);
    expect(inventoryUpdate).toEqual({ low_stock_threshold: 2 });
  });
});

describe('GET vendor product variants outlet scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorizeVendor.mockResolvedValue(access());

    const productQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: productId,
          outlet_id: null,
          outlet_offers: [{ outlet_id: assignedOutletId, status: 'active' }],
        },
        error: null,
      }),
    };
    const variantsQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: [{
          id: 'variant-1',
          inventory: [
            { outlet_id: assignedOutletId, quantity: 7 },
            { outlet_id: 'outlet-other', quantity: 91 },
          ],
        }],
        error: null,
      }),
    };
    mocks.from.mockImplementation((table: string) => table === 'products' ? productQuery : variantsQuery);
  });

  it('returns inventory only for the manager assigned outlet', async () => {
    const response = await GETVariants(new Request('http://localhost'), {
      params: Promise.resolve({ vendorId, productId }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data[0].inventory).toEqual([
      { outlet_id: assignedOutletId, quantity: 7 },
    ]);
  });
});
