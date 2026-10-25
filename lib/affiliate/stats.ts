// P4 — Member 4: affiliate dashboard stats. See CLAUDE.md Step 6, rebuilt
// per CLAUDE-FIXES.md Fix 3c around "earnings grouped by product" as the
// core ask.
//
// Vocabulary (use these words, and only these, in any UI built on top of this):
//   Click      = someone opened my link (any affiliate_clicks row on my link)
//   Referral   = a click that became a paid order (a non-reversed affiliate_attributions row) —
//                CLAUDE-FIXES.md prefers "people who ordered" in user-facing copy; same concept.
//   Earnings   = commission from referrals: Pending (status='pending') -> cleared into the real wallet
//
// Phase 2 (migration 014): a real clearing job now exists
// (lib/affiliate/clearing.ts) — pending commission eventually clears once
// /api/admin/affiliate/run-clearing (or the dev force-clear route)
// processes it past platform_settings['wallet.clearance_days'].
//
// ⚠️ Fix 3c deviation: "Available to withdraw" now reads wallets.earnings_sen
// directly instead of summing 'confirmed' affiliate_attributions, per the
// doc's own instruction ("read the same column their wallet page reads").
// These aren't always equal: earnings_sen also includes any non-affiliate
// earnings (e.g. the recommendation-reward system uses the same
// credit_earnings() RPC) and is reduced by anything already withdrawn — it's
// the actual spendable/withdrawable balance, not a historical affiliate-only
// sum. The Cash Out button's enabled/disabled state has to match reality,
// not a derived number that can drift from it.
//
// ⚠️ Also found while adding "order amount" to the earnings history:
// orders_own_or_admin (007_public_read_policies.sql) grants SELECT to the
// buyer, an admin, or the vendor who owns the product — NOT the affiliate
// who earned a commission from it. Under the cookie-aware client (which
// this function is normally called with — see app/api/affiliate/stats/route.ts),
// an affiliate's own dashboard would see every order's total silently come
// back empty, since RLS has no concept of "this order generated a
// commission you're entitled to see the total of." The order lookup below
// uses the service-role client specifically for that reason — everything
// else in this function stays on whatever client the caller passed in.

import type { SupabaseClient } from '@supabase/supabase-js';
import { getClearanceDays } from './settings';
import { getTierForUser, type TierInfo } from './tier';
import { createServiceClient } from '@/lib/supabase/service';
import type { Funnel } from './funnel';
import { resolveProductNames } from './product-names';

export interface AffiliateProductStat {
  productId: string;
  productName: string;
  shares: number;
  clicks: number;
  referrals: number;
  earnings: number;
  /** Referrals that were later reversed (order cancelled/refunded) — a subset of this product's total attributions, NOT counted in `referrals`/`earnings` above. Real refund-risk signal for lib/affiliate/copilot.ts. */
  reversedReferrals: number;
}

/**
 * CLAUDE-CAMPAIGN-CLEARING-TRANSLATE.md Feature 1: clicks/referrals/earnings
 * grouped by the click's `campaign` label (migration 20260820000000).
 * `campaign: null` is the "Untagged" bucket — every click before this
 * feature shipped, plus any share where the affiliate left the field blank.
 */
export interface AffiliateCampaignStat {
  campaign: string | null;
  clicks: number;
  referrals: number;
  earnings: number;
}

export interface AffiliateDailyClicks {
  date: string; // YYYY-MM-DD
  clicks: number;
}

export interface AffiliateCommission {
  id: string;
  productName: string | null;
  orderAmount: number | null;
  /** The rate stamped onto this attribution at the time it was created — never recomputed from the current tier. */
  rate: number;
  amount: number;
  status: 'pending' | 'confirmed' | 'reversed' | 'rejected';
  createdAt: string;
  clearedAt: string | null;
  /** Days until this clears, floored at 0. null once it's no longer pending. */
  clearsInDays: number | null;
}

export interface AffiliateStats {
  affiliateCode: string | null;
  totals: {
    clicks: number;
    referrals: number;
    pendingEarnings: number;
    availableToWithdraw: number;
    /** Lifetime pending+confirmed commission (excludes reversed/rejected) — unlike availableToWithdraw, never drops after a withdrawal. */
    totalEarnings: number;
  };
  byProduct: AffiliateProductStat[];
  byCampaign: AffiliateCampaignStat[];
  clicksByDay: AffiliateDailyClicks[];
  commissions: AffiliateCommission[];
  /**
   * CLAUDE-FUNNEL-AI.md §12.3: share_events -> affiliate_clicks ->
   * affiliate_attributions, connected. Per-platform clicks/conversions are
   * only real once affiliate_clicks.source is populated (migration 035,
   * written going forward) — see lib/affiliate/funnel.ts for the honest
   * degrade-gracefully behavior before that.
   */
  funnel: Funnel;
  tier: TierInfo;
}

/** Aggregates the owner's full history in SQL; only grouped results and five preview rows cross the API. */
export async function getAffiliateStats(service: SupabaseClient, userId: string): Promise<AffiliateStats> {
  const { data, error } = await service.rpc('get_my_affiliate_dashboard_summary');
  if (error || !data || typeof data !== 'object') throw new Error('affiliate_dashboard_unavailable');
  const result = data as {
    affiliateCode: string | null;
    totals: AffiliateStats['totals'];
    byProduct: Array<Omit<AffiliateProductStat, 'productName'>>;
    byCampaign: AffiliateCampaignStat[];
    clicksByDay: AffiliateDailyClicks[];
    commissions: Array<{
      id: string; productId: string | null; targetType: string | null; orderAmount: number | string | null;
      rate: number | string; amount: number | string; status: string; createdAt: string; clearedAt: string | null;
    }>;
    funnel: Funnel;
  };
  const productIds = [...new Set([
    ...result.byProduct.map((row) => row.productId),
    ...result.commissions.filter((row) => row.targetType === 'product').map((row) => row.productId).filter((id): id is string => Boolean(id)),
  ])];
  const serviceClient = createServiceClient();
  const [productNames, clearanceDays, tier] = await Promise.all([
    resolveProductNames(productIds),
    getClearanceDays(serviceClient),
    getTierForUser(serviceClient, userId),
  ]);
  const commissions: AffiliateCommission[] = result.commissions.map((row) => ({
    id: row.id,
    productName: row.targetType === 'product' && row.productId
      ? productNames.get(row.productId) ?? 'Deleted listing'
      : null,
    orderAmount: row.orderAmount === null ? null : Number(row.orderAmount),
    rate: Number(row.rate),
    amount: Number(row.amount),
    status: row.status as AffiliateCommission['status'],
    createdAt: row.createdAt,
    clearedAt: row.clearedAt,
    clearsInDays: row.status === 'pending'
      ? Math.max(0, Math.ceil(clearanceDays - (Date.now() - new Date(row.createdAt).getTime()) / 86_400_000))
      : null,
  }));
  return {
    affiliateCode: result.affiliateCode,
    totals: result.totals,
    byProduct: result.byProduct.map((row) => ({ ...row, productName: productNames.get(row.productId) ?? 'Deleted listing' })),
    byCampaign: result.byCampaign,
    clicksByDay: result.clicksByDay,
    commissions,
    funnel: result.funnel,
    tier,
  };
}
