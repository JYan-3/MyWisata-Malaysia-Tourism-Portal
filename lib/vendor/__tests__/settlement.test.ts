import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyOrderPlatformFeeFloor, getVendorSettlements, runVendorSettlementMaintenance } from '@/lib/vendor/settlement';

function serviceFor(rows: unknown[], error: unknown = null) {
  const order = vi.fn(async () => ({ data: error ? null : rows, error }));
  const eq = vi.fn(() => ({ order }));
  const select = vi.fn(() => ({ eq }));
  return { service: { from: vi.fn(() => ({ select })) } as never, eq };
}

function row(o: Record<string, unknown> = {}) {
  return {
    id: 's1',
    order_id: 'o1',
    gross_sen: 10000,
    platform_fee_sen: 1500,
    vendor_net_sen: 8500,
    platform_rate: 0.15,
    status: 'pending',
    hold_until: '2026-03-15T00:00:00.000Z',
    reversed_amount_sen: 0,
    created_at: '2026-03-05T00:00:00.000Z',
    orders: { display_id: 'MW-1001' },
    ...o,
  };
}

describe('getVendorSettlements', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-10T00:00:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('buckets pending / confirmed / reversed and totals net of reversals', async () => {
    const { service } = serviceFor([
      row({ id: 'a', status: 'pending', vendor_net_sen: 8500 }),
      row({ id: 'b', status: 'confirmed', vendor_net_sen: 4000, hold_until: null }),
      row({ id: 'c', status: 'reversed', vendor_net_sen: 2000, reversed_amount_sen: 2000, hold_until: null }),
      row({ id: 'd', status: 'confirmed', vendor_net_sen: 5000, reversed_amount_sen: 1000, hold_until: null }),
    ]);
    const result = await getVendorSettlements(service, 'vendor-1');

    expect(result.totals.pendingSen).toBe(8500);
    expect(result.totals.clearedSen).toBe(4000 + (5000 - 1000));
    expect(result.totals.lifetimePlatformFeesSen).toBe(1500 * 3); // reversed row excluded
    expect(result.settlements.map((s) => s.status)).toEqual(['pending', 'confirmed', 'reversed', 'confirmed']);
  });

  it('derives clearsInDays from hold_until for pending rows only', async () => {
    const { service } = serviceFor([
      row({ id: 'a', status: 'pending', hold_until: '2026-03-15T00:00:00.000Z' }),
      row({ id: 'b', status: 'confirmed', hold_until: '2026-03-20T00:00:00.000Z' }),
    ]);
    const [a, b] = (await getVendorSettlements(service, 'vendor-1')).settlements;
    expect(a.clearsInDays).toBe(5);
    expect(b.clearsInDays).toBeNull();
  });

  it('scopes the query to the vendor and returns empty on error', async () => {
    const { service, eq } = serviceFor([], { message: 'boom' });
    const result = await getVendorSettlements(service, 'vendor-9');
    expect(eq).toHaveBeenCalledWith('vendor_id', 'vendor-9');
    expect(result).toEqual({ totals: { pendingSen: 0, clearedSen: 0, lifetimePlatformFeesSen: 0 }, settlements: [] });
  });
});

it('reports a failed settlement instead of claiming it succeeded', async () => {
  const { settleOrderVendorEarnings } = await import('@/lib/vendor/settlement');
  const result = await settleOrderVendorEarnings({ rpc: async () => ({ data: null, error: { message: 'temporary failure' } }) } as never, 'order');
  expect(result).toBe(false);
});

it('reports platform fee floor RPC failure to its caller', async () => {
  await expect(applyOrderPlatformFeeFloor({ rpc: async () => ({ data: null, error: { message: 'temporary failure' } }) } as never, 'order'))
    .resolves.toBe(false);
  await expect(applyOrderPlatformFeeFloor({ rpc: async () => ({ data: { adjusted: 0 }, error: null }) } as never, 'order'))
    .resolves.toBe(true);
});

it('counts a fee floor RPC failure in vendor maintenance', async () => {
  const service = {
    firstHoldQuery: true,
    from(table: string) {
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = () => {
        if (table === 'order_settlements' && service.firstHoldQuery) {
          service.firstHoldQuery = false;
          return Promise.resolve({ data: [{ order_id: 'order-1' }], error: null });
        }
        return chain;
      };
      chain.in = () => chain;
      chain.order = () => chain;
      chain.limit = async () => ({ data: [], error: null });
      return chain;
    },
    rpc: async (name: string) => {
      if (name === 'apply_order_platform_fee_floor') return { data: null, error: { message: 'temporary failure' } };
      return { data: name === 'recompute_vendor_fee_tiers' ? 0 : [], error: null };
    },
  };

  await expect(runVendorSettlementMaintenance(service as never)).resolves.toMatchObject({ failed: 1 });
});

it('separates simulated settlements from withdrawable totals', async () => {
  const { service } = serviceFor([row({ is_simulated: true })]);
  const result = await getVendorSettlements(service, 'vendor');
  expect(result.totals.pendingSen).toBe(0);
  expect(result.settlements[0]).toMatchObject({ isSimulated: true });
});
