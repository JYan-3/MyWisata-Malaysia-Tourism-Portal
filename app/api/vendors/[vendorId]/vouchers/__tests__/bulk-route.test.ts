import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  isOutletManager: true,
  inserted: [] as Record<string, unknown>[],
  existingCodes: [] as { code: string }[],
  outletIds: [] as string[],
  outletId: '11111111-1111-4111-8111-111111111111',
}));

vi.mock('@/lib/vendor-authorization', () => ({
  authorizeVendor: vi.fn(async () => ({
    ok: true,
    access: {
      userId: fixtures.isOutletManager ? 'manager-user' : 'owner-user',
      vendorId: 'vendor-1',
      role: fixtures.isOutletManager ? 'outlet_manager' : 'vendor_owner',
      outletIds: fixtures.isOutletManager ? [fixtures.outletId] : [fixtures.outletId],
      isOwner: !fixtures.isOutletManager,
      isOutletManager: fixtures.isOutletManager,
      authDb: {},
      serviceDb: {
        from(table: string) {
          if (table === 'vouchers') {
            return {
              select() {
                return { eq: async () => ({ data: fixtures.existingCodes, error: null }) };
              },
              insert(records: Record<string, unknown>[]) {
                fixtures.inserted = records;
                return {
                  select: async () => ({
                    data: records.map((record, index) => ({ id: `voucher-${index + 1}`, code: record.code })),
                    error: null,
                  }),
                };
              },
            };
          }
          if (table === 'outlets') {
            return {
              select() {
                return { eq: () => ({ in: async (_column: string, ids: string[]) => ({ data: ids.filter((id) => fixtures.outletIds.includes(id)).map((id) => ({ id })) }) }) };
              },
            };
          }
          throw new Error(`Unexpected table ${table}`);
        },
      },
    },
  })),
}));

const OUTLET_ID = '11111111-1111-4111-8111-111111111111';

import { POST } from '@/app/api/vendors/[vendorId]/vouchers/bulk/route';

function upload(csv: string) {
  return POST(
    new Request('http://localhost/api/vendors/vendor-1/vouchers/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ csv }),
    }),
    { params: Promise.resolve({ vendorId: 'vendor-1' }) },
  );
}

describe('POST /api/vendors/[vendorId]/vouchers/bulk', () => {
  beforeEach(() => {
    fixtures.isOutletManager = true;
    fixtures.inserted = [];
    fixtures.existingCodes = [];
    fixtures.outletIds = [OUTLET_ID];
  });

  it.each([
    ['outlet manager', true, 'pending'],
    ['vendor owner', false, 'approved'],
  ])('%s imports redemption mode and applies the correct review stage', async (_role, isOutletManager, vendorReviewStatus) => {
    fixtures.isOutletManager = isOutletManager;
    const response = await upload([
      'code,name,voucherType,discountValue,maxUses,redemptionMode,outletId',
      `STORE10,Store voucher,percent,10,20,in_store,${OUTLET_ID}`,
    ].join('\n'));

    expect(response.status).toBe(201);
    expect(fixtures.inserted).toHaveLength(1);
    expect(fixtures.inserted[0]).toMatchObject({
      code: 'STORE10',
      redemption_mode: 'in_store',
      is_claimable: true,
      is_active: false,
      review_status: 'pending_review',
      vendor_review_status: vendorReviewStatus,
    });
  });

  it('rejects an imported limit that the single-create form rejects', async () => {
    const response = await upload([
      'code,name,voucherType,discountValue,maxUses,redemptionMode,outletId',
      `TOOMANY,Too many uses,percent,10,100001,both,${OUTLET_ID}`,
    ].join('\n'));

    expect(response.status).toBe(400);
    expect(fixtures.inserted).toEqual([]);
  });
});
