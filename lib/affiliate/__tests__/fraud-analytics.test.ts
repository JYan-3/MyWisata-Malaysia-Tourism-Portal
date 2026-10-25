import { describe, expect, it, vi } from 'vitest';
import { getFraudAnalytics } from '../fraud-analytics';

describe('getFraudAnalytics', () => {
  it('delegates the complete bounded aggregation to SQL', async () => {
    const payload = {
      range: '30d', overTime: [], byType: [], bySeverity: [],
      headline: { totalFlags: 2, selfReferralsBlocked: 1, duplicatePayoutsPrevented: 0, openFlags: 2, reviewedFlags: 0, dismissedFlags: 0, linksAutoDisabled: 0 },
      topFlaggedAffiliates: [],
    };
    const rpc = vi.fn().mockResolvedValue({ data: payload, error: null });
    await expect(getFraudAnalytics({ rpc } as never, '30d')).resolves.toEqual(payload);
    expect(rpc).toHaveBeenCalledWith('get_affiliate_fraud_analytics', { p_range: '30d' });
  });

  it('throws on aggregation failure instead of returning zero flags', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'timeout' } });
    await expect(getFraudAnalytics({ rpc } as never, '90d')).rejects.toThrow('affiliate_fraud_analytics_unavailable');
  });
});
