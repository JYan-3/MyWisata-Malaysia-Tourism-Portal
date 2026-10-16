import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logFraudFlag } from '@/lib/affiliate/fraud';

describe('logFraudFlag', () => {
  it('records a self-purchase without touching the link', async () => {
    const tables: string[] = [];
    const insert = vi.fn(() => ({ select: () => ({ single: async () => ({ data: { id: 'flag-1' }, error: null }) }) }));
    const service = { from: vi.fn((table: string) => { tables.push(table); return { insert }; }) } as unknown as SupabaseClient;

    for (let i = 0; i < 5; i++) {
      await logFraudFlag(service, { linkId: 'link-1', userId: 'u1', orderId: `o${i}`, flagType: 'self_referral', severity: 'low', detail: {} });
    }

    expect(tables.every((table) => table === 'affiliate_fraud_flags')).toBe(true);
    expect(insert).toHaveBeenCalledTimes(5);
  });
});
