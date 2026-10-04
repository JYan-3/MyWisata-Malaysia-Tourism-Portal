import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ savedDocument: null as Record<string, unknown> | null }));

vi.mock('@/lib/vendor-authorization', () => ({
  authorizeVendor: vi.fn(async () => ({
    ok: true,
    access: {
      userId: 'owner-user',
      vendorId: 'vendor-1',
      role: 'vendor_owner',
      outletIds: [],
      isOwner: true,
      isOutletManager: false,
      authDb: {},
      serviceDb: {
        from(table: string) {
          if (table !== 'vendor_voucher_csv_drafts') throw new Error(`Unexpected table ${table}`);
          return {
            insert(record: { title: string; document: Record<string, unknown> }) {
              state.savedDocument = record.document;
              return {
                select() {
                  return {
                    single: async () => ({
                      data: {
                        id: 'draft-1',
                        title: record.title,
                        document: record.document,
                        draft_version: 1,
                        created_at: '2026-10-03T00:00:00.000Z',
                        updated_at: '2026-10-03T00:00:00.000Z',
                      },
                      error: null,
                    }),
                  };
                },
              };
            },
          };
        },
      },
    },
  })),
}));

import { POST } from '@/app/api/vendors/[vendorId]/vouchers/drafts/route';

function draftPayload(redemptionMode?: string) {
  return {
    document: {
      title: 'Store voucher batch',
      rows: [{
        code: '',
        name: 'Store voucher',
        voucherType: 'fixed',
        ...(redemptionMode ? { redemptionMode } : {}),
        discountValue: '10',
        minSpend: '0',
        maxUses: '',
        perCustomerLimit: '',
        validFrom: '',
        validUntil: '',
        outletId: '',
        productId: '',
        buyQuantity: '',
        freeQuantity: '',
      }],
      autoGenerate: true,
      codePrefix: 'STORE',
    },
  };
}

describe('POST /api/vendors/[vendorId]/vouchers/drafts', () => {
  beforeEach(() => { state.savedDocument = null; });

  it('round-trips the selected redemption mode into the saved draft', async () => {
    const response = await POST(new Request('http://localhost/api/vendors/vendor-1/vouchers/drafts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(draftPayload('in_store')),
    }), { params: Promise.resolve({ vendorId: 'vendor-1' }) });

    expect(response.status).toBe(201);
    expect(state.savedDocument).toMatchObject({ rows: [{ redemptionMode: 'in_store' }] });
  });

  it('defaults pre-existing draft rows without redemption mode to online', async () => {
    const response = await POST(new Request('http://localhost/api/vendors/vendor-1/vouchers/drafts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(draftPayload()),
    }), { params: Promise.resolve({ vendorId: 'vendor-1' }) });

    expect(response.status).toBe(201);
    expect(state.savedDocument).toMatchObject({ rows: [{ redemptionMode: 'online' }] });
  });
});
