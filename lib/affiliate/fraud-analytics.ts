import type { SupabaseClient } from '@supabase/supabase-js';
import type { FraudFlagType, FraudSeverity } from './fraud';

export type FraudAnalyticsRange = '7d' | '30d' | '90d';

export interface FraudFlagsByDay {
  date: string;
  count: number;
}

export interface FraudTypeCount {
  flagType: FraudFlagType;
  count: number;
}

export interface FraudSeverityCount {
  severity: FraudSeverity;
  count: number;
}

export interface FraudAnalyticsHeadline {
  totalFlags: number;
  selfReferralsBlocked: number;
  duplicatePayoutsPrevented: number;
  openFlags: number;
  reviewedFlags: number;
  dismissedFlags: number;
  linksAutoDisabled: number;
}

export interface TopFlaggedAffiliate {
  userId: string;
  userName: string;
  affiliateCode: string | null;
  flagCount: number;
}

export interface FraudAnalytics {
  range: FraudAnalyticsRange;
  overTime: FraudFlagsByDay[];
  byType: FraudTypeCount[];
  bySeverity: FraudSeverityCount[];
  headline: FraudAnalyticsHeadline;
  topFlaggedAffiliates: TopFlaggedAffiliate[];
}

/** All counts and buckets are computed over the full bounded time window in SQL. */
export async function getFraudAnalytics(service: SupabaseClient, range: FraudAnalyticsRange): Promise<FraudAnalytics> {
  const { data, error } = await service.rpc('get_affiliate_fraud_analytics', { p_range: range });
  if (error || !data || typeof data !== 'object') throw new Error('affiliate_fraud_analytics_unavailable');
  return data as unknown as FraudAnalytics;
}
