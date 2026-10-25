// P4 — recommendation earnings, read side.
//
// The recommendation reward money path (credit_pending_recommendation ->
// clear_matured_recommendation_rewards) writes recommendation_commissions and
// the wallet buckets; nothing in the app has ever READ recommendation_commissions
// back for the recommender. This is that read — deliberately shaped to parallel
// AffiliateCommission in lib/affiliate/stats.ts so the same row UI renders both.
//
// RLS: rec_commissions_read_own, rec_conv_read and vendor_rec_read all allow
// `auth.uid() = recommender_id`, so the cookie-aware client resolves the whole
// commission -> conversion -> recommendation -> vendor_name chain on its own —
// no service client needed (unlike getAffiliateStats, which needs one only for
// the order-total lookup RLS can't express).

import type { SupabaseClient } from '@supabase/supabase-js';

export interface RecommendationCommissionRow {
  id: string;
  /** Deep-link target for /customer/recommendations/<id>; null if the join can't resolve. */
  recommendationId: string | null;
  vendorName: string | null;
  type: 'bonus' | 'ongoing';
  /** Ongoing rows only — the % stamped on at credit time. */
  rate: number | null;
  amount: number; // RM
  status: 'pending' | 'confirmed' | 'reversed';
  createdAt: string;
  /** Days until a pending row's hold matures, floored at 0. null unless pending. */
  clearsInDays: number | null;
}

export interface RecommendationEarnings {
  totals: {
    /** Σ pending commission amounts (RM). */
    pending: number;
    /** Σ commission amounts already cleared to the withdrawable wallet (RM). */
    lifetimeCleared: number;
    /** Distinct converted vendors this recommender has earned from. */
    convertedVendors: number;
  };
  /** Newest first. Includes reversed rows (shown, but excluded from totals). */
  commissions: RecommendationCommissionRow[];
  totalCount: number;
  pageSize: 10 | 25 | 50;
  hasMore: boolean;
  nextCursor: { createdAt: string; id: string } | null;
  snapshotCutoff: string;
}

export interface RecommendationEarningsQuery {
  recommendationId?: string;
  pageSize?: 10 | 25 | 50;
  cursor?: { createdAt: string; id: string } | null;
  snapshotCutoff?: string;
}

function clearsInDays(holdUntil: string | null): number | null {
  if (!holdUntil) return null;
  const remainingMs = new Date(holdUntil).getTime() - Date.now();
  return Math.max(0, Math.ceil(remainingMs / 86_400_000));
}

export async function getRecommendationEarnings(
  client: SupabaseClient,
  query: RecommendationEarningsQuery = {},
): Promise<RecommendationEarnings> {
  const pageSize = query.pageSize ?? 10;
  const snapshotCutoff = query.snapshotCutoff ?? new Date().toISOString();
  const { data, error } = await client.rpc('get_recommendation_earnings_page', {
    p_recommendation_id: query.recommendationId ?? null,
    p_snapshot_cutoff: snapshotCutoff,
    p_page_size: pageSize,
    p_before_created_at: query.cursor?.createdAt ?? null,
    p_before_id: query.cursor?.id ?? null,
  });
  if (error || !data || typeof data !== 'object') throw new Error('recommendation_earnings_unavailable');

  const result = data as {
    totals: RecommendationEarnings['totals'];
    totalCount: number;
    pageSize: 10 | 25 | 50;
    hasMore: boolean;
    nextCursor: RecommendationEarnings['nextCursor'];
    snapshotCutoff: string;
    commissions: Array<{
      id: string;
      conversionId: string | null;
      commissionType: string;
      amount: number | string;
      commissionRate: number | string | null;
      status: string;
      holdUntil: string | null;
      createdAt: string;
      recommendationId: string | null;
      vendorName: string | null;
    }>;
  };

  const commissions: RecommendationCommissionRow[] = result.commissions.map((row) => {
    const status = row.status === 'confirmed' || row.status === 'reversed' ? row.status : 'pending';
    return {
      id: row.id,
      recommendationId: row.recommendationId,
      vendorName: row.vendorName,
      type: row.commissionType === 'bonus' ? 'bonus' : 'ongoing',
      rate: row.commissionRate === null ? null : Number(row.commissionRate),
      amount: Number(row.amount),
      status,
      createdAt: row.createdAt,
      clearsInDays: status === 'pending' ? clearsInDays(row.holdUntil) : null,
    };
  });
  return { ...result, commissions };
}
