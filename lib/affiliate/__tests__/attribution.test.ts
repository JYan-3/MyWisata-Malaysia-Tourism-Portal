import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  inserts: [] as Array<{ table: string; row: Record<string, unknown> }>,
  insertError: null as { code: string } | null,
  logFraudFlag: vi.fn(),
  notify: vi.fn(),
}));

/** A tiny in-memory stand-in for the Supabase query builder: eq filters, maybeSingle, head counts, insert. */
function fakeService() {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let head = false;
      const rows = () => (mocks.tables[table] ?? []).filter((row) => filters.every(([key, value]) => row[key] === value));
      const builder: Record<string, unknown> = {
        select: (_columns?: string, options?: { head?: boolean }) => { head = Boolean(options?.head); return builder; },
        eq: (key: string, value: unknown) => { filters.push([key, value]); return builder; },
        gte: () => builder,
        in: () => builder,
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        insert: (row: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              if (mocks.insertError) return { data: null, error: mocks.insertError };
              mocks.inserts.push({ table, row });
              return { data: { id: 'attribution-1' }, error: null };
            },
          }),
        }),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(head ? { count: rows().length, error: null } : { data: rows(), error: null }).then(resolve),
      };
      return builder;
    },
  };
}

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => fakeService() }));
vi.mock('../settings', () => ({ getAttributionCookieDays: async () => 7 }));
vi.mock('../tier', () => ({ getTierForUser: async () => ({ rate: 0.03 }) }));
vi.mock('../fraud', () => ({ logFraudFlag: mocks.logFraudFlag, autoDisableLink: vi.fn() }));
vi.mock('../notifications', () => ({ notifyCommissionEarned: mocks.notify }));
vi.mock('../vendor-role-guard', () => ({ getVendorIneligibleRole: async () => null }));

import { onOrderPaid } from '../attribution';

const DAY = 86_400_000;
const orderPlaced = new Date('2026-10-01T10:00:00Z');

function seed({ clickDaysBeforeOrder = 1, status = 'paid', alreadyAttributed = false } = {}) {
  mocks.tables = {
    orders: [{ id: 'order-1', user_id: 'buyer-1', status, total_amount: 15, affiliate_click_id: 'click-1', paid_at: null, created_at: orderPlaced.toISOString() }],
    affiliate_clicks: [{ id: 'click-1', link_id: 'link-1', created_at: new Date(orderPlaced.getTime() - clickDaysBeforeOrder * DAY).toISOString() }],
    affiliate_links: [{ id: 'link-1', user_id: 'owner-1', is_active: true }],
    users: [{ id: 'owner-1', tier: 'kyc_verified', kyc_status: 'approved' }],
    affiliate_attributions: alreadyAttributed ? [{ id: 'old', order_id: 'order-1' }] : [],
    order_items: [],
  };
}

describe('onOrderPaid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.inserts = [];
    mocks.insertError = null;
    // The job may run long after the order: 10 days later here.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(orderPlaced.getTime() + 10 * DAY));
  });

  it('pays a referral placed within 7 days of the click, even when it is processed days later', async () => {
    seed({ clickDaysBeforeOrder: 6 });
    await onOrderPaid('order-1');
    expect(mocks.inserts).toEqual([{ table: 'affiliate_attributions', row: expect.objectContaining({ order_id: 'order-1', click_id: 'click-1', commission_rate: 0.03, status: 'pending' }) }]);
    expect(mocks.logFraudFlag).not.toHaveBeenCalled();
  });

  it('does not pay an order placed more than 7 days after the click', async () => {
    seed({ clickDaysBeforeOrder: 8 });
    await onOrderPaid('order-1');
    expect(mocks.inserts).toHaveLength(0);
    expect(mocks.logFraudFlag).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ flagType: 'expired_attribution', severity: 'low' }));
  });

  it('does nothing until the order is paid', async () => {
    seed({ status: 'pending_payment' });
    await onOrderPaid('order-1');
    expect(mocks.inserts).toHaveLength(0);
    expect(mocks.logFraudFlag).not.toHaveBeenCalled();
  });

  it('is a quiet no-op for an order that already has a commission', async () => {
    seed({ alreadyAttributed: true });
    await onOrderPaid('order-1');
    expect(mocks.inserts).toHaveLength(0);
    expect(mocks.logFraudFlag).not.toHaveBeenCalled();
  });

  it('treats losing a race to another run as normal, not as a fraud flag', async () => {
    seed();
    mocks.insertError = { code: '23505' };
    await onOrderPaid('order-1');
    expect(mocks.logFraudFlag).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('still blocks a commission on the owner\'s own purchase', async () => {
    seed();
    (mocks.tables.orders[0] as Record<string, unknown>).user_id = 'owner-1';
    await onOrderPaid('order-1');
    expect(mocks.inserts).toHaveLength(0);
    expect(mocks.logFraudFlag).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ flagType: 'self_referral', severity: 'low' }));
  });
});
