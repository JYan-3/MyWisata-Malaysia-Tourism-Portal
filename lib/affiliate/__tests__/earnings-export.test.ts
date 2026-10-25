import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createServiceClient: vi.fn(), resolveProductNames: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: mocks.createServiceClient }));
vi.mock('../product-names', () => ({ resolveProductNames: mocks.resolveProductNames }));

const { getAffiliateEarningsExportPages } = await import('../earnings-export');

function attribution(id: string, index: number) {
  return {
    id, click_id: 'click-1', order_id: `order-${index}`, commission_rate: 0.03,
    commission_amount: 1, status: 'confirmed', created_at: `2026-10-24T00:${String(index % 60).padStart(2, '0')}:00.000Z`,
    cleared_at: null, confirmed_at: '2026-10-25T00:00:00.000Z',
    affiliate_clicks: [{ target_type: 'product', target_id: 'product-1', link_id: 'link-1' }],
  };
}

function serviceFor(pages: Array<Array<ReturnType<typeof attribution>>>) {
  let pageIndex = 0;
  const cursorCalls: string[] = [];
  const ownerLinkIds: string[][] = [];
  const service = {
    from(table: string) {
      if (table === 'affiliate_links') return { select: () => ({ eq: async () => ({ data: [{ id: 'link-1' }, { id: 'link-2' }], error: null }) }) };
      if (table === 'affiliate_attributions') {
        let isCount = false;
        const builder = {
          eq: () => builder,
          lte: () => builder,
          gte: () => builder,
          order: () => builder,
          limit: () => builder,
          in: (_key: string, values: string[]) => { ownerLinkIds.push(values); return builder; },
          or: (value: string) => { cursorCalls.push(value); return builder; },
          then(resolve: (value: unknown) => unknown) {
            if (isCount) return Promise.resolve(resolve({ data: null, count: 501, error: null }));
            const data = pages[pageIndex] ?? [];
            pageIndex += 1;
            return Promise.resolve(resolve({ data, error: null }));
          },
        };
        return { select: (_columns: string, options?: { head?: boolean }) => { isCount = options?.head === true; return builder; } };
      }
      throw new Error(`unexpected caller query: ${table}`);
    },
  };
  return { service: service as never, cursorCalls, ownerLinkIds };
}

describe('getAffiliateEarningsExport', () => {
  it('uses owner join, a fixed cutoff and stable bounded batches until the complete result is read', async () => {
    const first = Array.from({ length: 501 }, (_, index) => attribution(`id-${index}`, index));
    const { service, cursorCalls, ownerLinkIds } = serviceFor([first, first.slice(500)]);
    mocks.createServiceClient.mockReturnValue({ from: () => ({ select: () => ({ in: async () => ({
      data: [{ id: 'order-0', display_id: 'ORD-0', total_amount: 10 }], error: null,
    }) }) }) });
    mocks.resolveProductNames.mockResolvedValue(new Map([['product-1', 'Synthetic product']]));

    const pages = [];
    for await (const page of getAffiliateEarningsExportPages(service, 'owner-1', 'all')) pages.push(page);
    const rows = pages.flat();
    expect(rows).toHaveLength(501);
    expect(pages.map((page) => page.length)).toEqual([500, 1]);
    expect(rows[0]).toMatchObject({ productName: 'Synthetic product', orderReference: 'ORD-0', orderAmount: 10 });
    expect(cursorCalls).toHaveLength(1);
    expect(cursorCalls[0]).toContain('created_at.lt.');
    expect(ownerLinkIds).toEqual([['link-1', 'link-2'], ['link-1', 'link-2'], ['link-1', 'link-2']]);
  });

  it('does not turn query errors into an apparently complete empty export', async () => {
    const { service } = serviceFor([[]]);
    (service as unknown as { from: (table: string) => unknown }).from = (table: string) => table === 'affiliate_links'
      ? { select: () => ({ eq: async () => ({ data: [{ id: 'link-1' }], error: null }) }) }
      : { select: () => ({ in: () => ({ lte: () => ({ then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: null, count: null, error: new Error('query failed') })) }) }) }) };
    const iterator = getAffiliateEarningsExportPages(service, 'owner-1', 'month');
    await expect(iterator.next()).rejects.toThrow();
  });

  it('rejects an over-budget export before yielding rows', async () => {
    const { service: oversized } = serviceFor([[]]);
    const query = oversized as unknown as { from: (table: string) => unknown };
    const original = query.from.bind(oversized);
    query.from = (table) => {
      if (table === 'affiliate_attributions') {
        let countQuery = false;
        const builder = {
          in: () => builder, lte: () => builder, gte: () => builder,
          select: (_columns: string, options?: { head?: boolean }) => { countQuery = options?.head === true; return builder; },
          then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve(countQuery
            ? { data: null, count: 20_001, error: null }
            : { data: [], count: 0, error: null })),
        };
        return { select: (_columns: string, options?: { head?: boolean }) => { countQuery = options?.head === true; return builder; } };
      }
      return original(table);
    };
    const iterator = getAffiliateEarningsExportPages(query as never, 'owner-1', 'all');
    await expect(iterator.next()).rejects.toThrow('affiliate_earnings_export_limit_exceeded');
  });
});
