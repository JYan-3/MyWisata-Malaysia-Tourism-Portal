import { describe, expect, it, vi } from 'vitest';
import { getDisabledLinks } from '../fraud';

describe('affiliate fraud admin display names', () => {
  it('uses only owner names and does not fetch email as a fallback', async () => {
    const usersSelect = vi.fn(() => ({
      in: async () => ({ data: [{ id: 'owner-1', full_name: null }], error: null }),
    }));
    const service = {
      from(table: string) {
        if (table === 'affiliate_links') {
          const rows = [{ id: 'link-1', user_id: 'owner-1', affiliate_code: 'ABC' }];
          const builder = {
            select: () => builder,
            eq: () => builder,
            order: () => builder,
            range: async () => ({ data: rows, count: 1, error: null }),
          };
          return builder;
        }
        if (table === 'users') return { select: usersSelect };
        throw new Error(`Unexpected table ${table}`);
      },
    };

    const result = await getDisabledLinks(service as never);

    expect(usersSelect).toHaveBeenCalledWith('id, full_name');
    expect(result.items[0].userName).toBe('Unknown user');
  });
});
