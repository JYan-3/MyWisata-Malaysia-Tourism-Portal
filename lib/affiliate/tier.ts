// P4 — Member 4: tiered commission. CLAUDE-PHASE2.md Feature B.
//
// Rates are never hardcoded here — always read from commission_rules so an
// admin can change them. Replaces the old flat-rate lookup
// (lib/affiliate/commission.ts, deleted) in lib/affiliate/attribution.ts.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface CommissionTier {
  id: string;
  tierName: string;
  rate: number; // 0..1 fraction
  minReferrals: number;
  /** Lifetime confirmed sales amount (RM sen) required to hold this tier. 0 = no requirement. */
  minSalesAmountSen: number;
  /** Must have a CONFIRMED referral within this many days to hold this tier. null = no recency requirement. */
  activePeriodDays: number | null;
  /** Max % of clicks that may be fraud-flagged while still holding this tier. null = no cap. */
  maxFraudRatePercent: number | null;
}

/** What resolveTier() needs to know about one affiliate to pick their tier. */
export interface TierSignals {
  referralCount: number;
  salesAmountSen: number;
  /** Days since the most recent CONFIRMED referral, or null if they've never had one. */
  daysSinceLastConfirmed: number | null;
  fraudRatePercent: number;
}

export interface TierInfo {
  tierName: string;
  rate: number;
  referralCount: number;
  nextTier: CommissionTier | null;
  referralsToNext: number | null;
}

// Only used if commission_rules has no active affiliate tier rows at all
// (e.g. migration 014 hasn't run yet) — never used to override real rates.
// id is a sentinel, not a real row — the admin tier editor should never
// try to PATCH this one. Name matches the CLAUDE-QUICKWINS.md Item 2
// rename (migration 038) — label only, this fallback's rate is unaffected.
// Fully open on every threshold, same as 'standard' — a fallback tier must
// always be reachable.
const FALLBACK_TIER: CommissionTier = {
  id: '', tierName: 'standard', rate: 0.03, minReferrals: 0,
  minSalesAmountSen: 0, activePeriodDays: null, maxFraudRatePercent: null,
};

/** All active affiliate tiers, ascending by threshold. */
export async function getActiveTiers(service: SupabaseClient): Promise<CommissionTier[]> {
  const { data, error } = await service
    .from('commission_rules')
    .select('id, tier_name, ongoing_rate, min_conversions, min_sales_amount_sen, active_period_days, max_fraud_rate_percent')
    .eq('rule_type', 'affiliate')
    .eq('is_active', true)
    .order('min_conversions', { ascending: true });
  if (error) throw new Error('affiliate_tiers_unavailable');

  const tiers = (data ?? [])
    .filter((r) => r.tier_name)
    .map((r) => ({
      id: r.id as string,
      tierName: r.tier_name as string,
      rate: Number(r.ongoing_rate),
      minReferrals: r.min_conversions ?? 0,
      minSalesAmountSen: Number(r.min_sales_amount_sen ?? 0),
      activePeriodDays: r.active_period_days ?? null,
      maxFraudRatePercent: r.max_fraud_rate_percent === null || r.max_fraud_rate_percent === undefined ? null : Number(r.max_fraud_rate_percent),
    }));

  return tiers.length ? tiers : [FALLBACK_TIER];
}

/**
 * Gathers every signal resolveTier() needs for one affiliate: lifetime
 * confirmed referral count, lifetime confirmed sales amount (order gross,
 * not commission), recency of their last confirmed referral, and their
 * fraud-flag rate over their own clicks.
 */
async function getReferralSignals(service: SupabaseClient, userId: string): Promise<TierSignals> {
  const { data, error } = await service.rpc('affiliate_tier_signals', { p_user_id: userId });
  if (error || !data || typeof data !== 'object') throw new Error('affiliate_tier_signals_unavailable');

  const result = data as Record<string, unknown>;
  const clickCount = Number(result.click_count);
  const flagCount = Number(result.flag_count);
  const referralCount = Number(result.referral_count);
  const salesAmountSen = Number(result.sales_amount_sen);
  const lastConfirmedAt = typeof result.last_confirmed_at === 'string' ? result.last_confirmed_at : null;
  if (![clickCount, flagCount, referralCount, salesAmountSen].every(Number.isFinite)
    || clickCount < 0 || flagCount < 0 || referralCount < 0 || salesAmountSen < 0) {
    throw new Error('affiliate_tier_signals_invalid');
  }
  const daysSinceLastConfirmed = lastConfirmedAt
    ? Math.floor((Date.now() - new Date(lastConfirmedAt).getTime()) / 86_400_000)
    : null;
  return {
    referralCount,
    salesAmountSen,
    daysSinceLastConfirmed,
    fraudRatePercent: clickCount > 0 ? flagCount / clickCount * 100 : 0,
  };
}

function meetsTier(tier: CommissionTier, signals: TierSignals): boolean {
  if (signals.referralCount < tier.minReferrals) return false;
  if (signals.salesAmountSen < tier.minSalesAmountSen) return false;
  if (tier.activePeriodDays !== null) {
    if (signals.daysSinceLastConfirmed === null || signals.daysSinceLastConfirmed > tier.activePeriodDays) return false;
  }
  if (tier.maxFraudRatePercent !== null && signals.fraudRatePercent > tier.maxFraudRatePercent) return false;
  return true;
}

/**
 * Pure: picks the highest tier whose full set of requirements — conversion
 * count, sales amount, recency ("active period"), and fraud rate — the
 * affiliate currently satisfies, out of `tiers` (must already be sorted
 * ascending by minReferrals — as getActiveTiers() returns them). Because
 * recency and fraud rate can both regress over time, this can genuinely
 * return a LOWER tier than one the affiliate held before, even though their
 * lifetime referral count/sales amount never decreased — that's the only
 * way a downgrade can happen, since those two signals are monotonic.
 *
 * Exported so callers who already have per-link data in memory (e.g. the
 * admin oversight page, which loads every attribution at once) can resolve
 * everyone's tier locally instead of one getTierForUser() DB round-trip per
 * affiliate.
 */
export function resolveTier(tiers: CommissionTier[], signals: TierSignals): TierInfo {
  let current = tiers[0];
  let currentIndex = 0;
  for (let i = 0; i < tiers.length; i++) {
    if (meetsTier(tiers[i], signals)) {
      current = tiers[i];
      currentIndex = i;
    }
  }

  const nextTier = tiers[currentIndex + 1] ?? null;
  const referralsToNext = nextTier ? Math.max(0, nextTier.minReferrals - signals.referralCount) : null;

  return {
    tierName: current.tierName,
    rate: current.rate,
    referralCount: signals.referralCount,
    nextTier,
    referralsToNext,
  };
}

/**
 * Resolves userId's current tier from their live referral signals (lifetime
 * CONFIRMED referrals only — not pending, a tier shouldn't be buyable with
 * commissions that might still reverse).
 */
export async function getTierForUser(service: SupabaseClient, userId: string): Promise<TierInfo> {
  const tiers = await getActiveTiers(service);
  const signals = await getReferralSignals(service, userId);
  return resolveTier(tiers, signals);
}
