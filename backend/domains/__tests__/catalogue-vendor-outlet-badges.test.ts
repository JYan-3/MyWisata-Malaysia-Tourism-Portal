import { describe, expect, it, vi } from 'vitest';

vi.mock('@/backend/supabase', () => ({ supabase: {} }));

const { getVendors } = await import('@/backend/domains/catalogue');

function mockDatabase(results: unknown[]) {
  const select = vi.fn();
  for (const result of results) select.mockResolvedValueOnce(result);
  const from = vi.fn(() => ({ select }));
  return { db: { from } as never, from, select };
}

describe('getVendors outlet badge projection', () => {
  it('maps branch badge slugs from the existing nested outlet query', async () => {
    const { db, select } = mockDatabase([{
      data: [{
        id: 'vendor-1', name: 'Vendor', status: 'approved', kind: 'shop', logo_url: null, cover_url: null,
        outlets: [{ id: 'outlet-1', name: 'Branch', city: 'Ipoh', state: 'Perak', status: 'active', review_status: 'approved', operating_hours: null, badge_slugs: ['hidden_gem'] }],
      }],
      error: null,
    }]);

    const vendors = await getVendors(db);

    expect(select).toHaveBeenCalledWith(expect.stringContaining('operating_hours,badge_slugs'));
    expect(vendors[0].outlets[0].badgeSlugs).toEqual(['hidden_gem']);
  });

  it('falls back to the legacy outlet projection before the additive migration is applied', async () => {
    const { db, select } = mockDatabase([
      { data: null, error: { code: 'PGRST204', message: "Could not find the 'badge_slugs' column of 'outlets' in the schema cache" } },
      { data: [{
        id: 'vendor-1', name: 'Vendor', status: 'approved', kind: 'shop', logo_url: null, cover_url: null,
        outlets: [{ id: 'outlet-1', name: 'Branch', city: 'Ipoh', state: 'Perak', status: 'active', review_status: 'approved', operating_hours: null }],
      }], error: null },
    ]);

    const vendors = await getVendors(db);

    expect(select).toHaveBeenCalledTimes(2);
    expect(select.mock.calls[1][0]).not.toContain('badge_slugs');
    expect(vendors[0].outlets[0].badgeSlugs).toEqual([]);
  });
});
