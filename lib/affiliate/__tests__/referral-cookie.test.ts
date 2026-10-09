import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  clickExists: true,
  updates: [] as Array<{ values: Record<string, unknown>; filters: string[] }>,
  queried: 0,
}));

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => (mocks.cookie ? { value: mocks.cookie } : undefined) }) }));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === 'affiliate_clicks') {
        mocks.queried++;
        return { select: () => ({ eq: (_k: string, id: string) => ({ maybeSingle: async () => ({ data: mocks.clickExists ? { id } : null }) }) }) };
      }
      return {
        update: (values: Record<string, unknown>) => {
          const filters: string[] = [];
          const chain = {
            eq: (k: string, v: string) => { filters.push(`${k}=${v}`); return chain; },
            is: async (k: string, v: null) => { filters.push(`${k} is ${v}`); mocks.updates.push({ values, filters }); return { error: null }; },
          };
          return chain;
        },
      };
    },
  }),
}));

import { stampReferralFromCookie } from '../referral-cookie';

const CLICK = '11111111-1111-4111-8111-111111111111';

describe('stampReferralFromCookie', () => {
  beforeEach(() => {
    mocks.cookie = undefined;
    mocks.clickExists = true;
    mocks.updates = [];
    mocks.queried = 0;
  });

  it('saves a real referral click on the new order without overwriting an existing one', async () => {
    mocks.cookie = CLICK;
    await stampReferralFromCookie('order-1');
    expect(mocks.updates).toEqual([{ values: { affiliate_click_id: CLICK }, filters: ['id=order-1', 'affiliate_click_id is null'] }]);
  });

  it('ignores a cookie whose click does not exist', async () => {
    mocks.cookie = CLICK;
    mocks.clickExists = false;
    await stampReferralFromCookie('order-1');
    expect(mocks.updates).toEqual([]);
  });

  it('ignores a malformed cookie without touching the database', async () => {
    mocks.cookie = 'not-a-uuid';
    await stampReferralFromCookie('order-1');
    expect(mocks.queried).toBe(0);
    expect(mocks.updates).toEqual([]);
  });

  it('does nothing without a cookie or without an order', async () => {
    await stampReferralFromCookie('order-1');
    mocks.cookie = CLICK;
    await stampReferralFromCookie(undefined);
    expect(mocks.updates).toEqual([]);
  });
});
