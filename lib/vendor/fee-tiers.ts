// Vendor platform fee tiers — shared types, validation and labels for the
// admin editor, the vendor wallet and their API routes. The fee itself is
// charged in SQL (settle_order_vendor_earnings, migration 20261007230000).

import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { databaseUuidSchema } from '@/lib/validation/schemas';

export const EVENT_FEE_SETTING_KEY = 'platform_fee.event_per_item_sen';
/** Fixed fees are capped at RM1,000 per item (matches the DB CHECK). */
export const MAX_PER_ITEM_SEN = 100_000;

export type FeeTier = {
  rank: 1 | 2 | 3;
  name: string;
  feeType: 'percent' | 'fixed';
  /** 0–0.9999 when feeType = 'percent'. */
  percentRate: number | null;
  /** Sen per item when feeType = 'fixed'. */
  fixedPerItemSen: number | null;
  minSalesSen: number;
};

type TierRow = { rank: number; name: string; fee_type: string; percent_rate: number | string | null; fixed_per_item_sen: number | string | null; min_sales_sen: number | string };

export function mapTier(row: TierRow): FeeTier {
  return {
    rank: row.rank as FeeTier['rank'],
    name: row.name,
    feeType: row.fee_type === 'fixed' ? 'fixed' : 'percent',
    percentRate: row.percent_rate === null ? null : Number(row.percent_rate),
    fixedPerItemSen: row.fixed_per_item_sen === null ? null : Number(row.fixed_per_item_sen),
    minSalesSen: Number(row.min_sales_sen),
  };
}

export async function loadFeeTiers(service: SupabaseClient): Promise<FeeTier[]> {
  const { data, error } = await service.from('vendor_fee_tiers').select('rank,name,fee_type,percent_rate,fixed_per_item_sen,min_sales_sen').order('rank');
  if (error) throw new Error(error.message);
  return ((data ?? []) as TierRow[]).map(mapTier);
}

const tierSchema = z.object({
  rank: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  name: z.string().trim().min(1).max(40),
  feeType: z.enum(['percent', 'fixed']),
  percentRate: z.number().min(0).max(0.9999).nullable(),
  fixedPerItemSen: z.number().int().min(0).max(MAX_PER_ITEM_SEN).nullable(),
  minSalesSen: z.number().int().min(0),
}).refine((tier) => tier.feeType === 'percent' ? tier.percentRate !== null : tier.fixedPerItemSen !== null, { message: 'Enter the fee for every tier' });

export const feeSettingsSchema = z.object({
  tiers: z.array(tierSchema).length(3),
  eventDefaultPerItemSen: z.number().int().min(0).max(MAX_PER_ITEM_SEN).nullable(),
  campaignFees: z.array(z.object({ id: databaseUuidSchema, perItemSen: z.number().int().min(0).max(MAX_PER_ITEM_SEN).nullable() })).max(200),
  reason: z.string().trim().min(10).max(500),
}).refine(({ tiers }) => tiers.map((tier) => tier.rank).join() === '1,2,3', { message: 'Send tiers 1, 2 and 3 in order' })
  .refine(({ tiers }) => tiers[0].minSalesSen === 0, { message: 'The first tier must start at RM0' })
  .refine(({ tiers }) => tiers[0].minSalesSen < tiers[1].minSalesSen && tiers[1].minSalesSen < tiers[2].minSalesSen, { message: 'Each tier needs a higher sales threshold than the one before' });

export type FeeSettingsInput = z.infer<typeof feeSettingsSchema>;

export const feeTierPinSchema = z.object({
  pinnedRank: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable(),
});

/** Fee of one tier as a short label: "15%" or "RM1.00 / item". */
export function feeLabel(tier: Pick<FeeTier, 'feeType' | 'percentRate' | 'fixedPerItemSen'>, formatSen: (sen: number) => string, perItem: string): string {
  if (tier.feeType === 'fixed') return `${formatSen(tier.fixedPerItemSen ?? 0)} / ${perItem}`;
  return `${Number(((tier.percentRate ?? 0) * 100).toFixed(2))}%`;
}

export type VendorFeeSummary = {
  tier: FeeTier;
  /** Rolling 90-day settled sales the placement used. */
  salesSen: number;
  pinned: boolean;
  /** The next tier up and the sales it needs; null at the top or when pinned. */
  next: { name: string; minSalesSen: number } | null;
};

/** The caller vendor's current fee, read-only. Null on any failure: display only. */
export async function getVendorFee(service: SupabaseClient, vendorId: string): Promise<VendorFeeSummary | null> {
  try {
    const [{ data: vendor }, tiers] = await Promise.all([
      service.from('vendors').select('fee_tier_rank,fee_tier_pinned,fee_tier_sales_sen').eq('id', vendorId).maybeSingle(),
      loadFeeTiers(service),
    ]);
    if (!vendor) return null;
    const rank = effectiveRank(vendor);
    const tier = tiers.find((row) => row.rank === rank);
    if (!tier) return null;
    const pinned = vendor.fee_tier_pinned !== null;
    const next = pinned ? undefined : tiers.find((row) => row.rank === rank + 1);
    return { tier, salesSen: Number(vendor.fee_tier_sales_sen ?? 0), pinned, next: next ? { name: next.name, minSalesSen: next.minSalesSen } : null };
  } catch {
    return null;
  }
}

/** The vendor's tier: an admin pin wins over the nightly sales placement. */
export function effectiveRank(vendor: { fee_tier_rank: number | null; fee_tier_pinned: number | null }): number {
  return vendor.fee_tier_pinned ?? vendor.fee_tier_rank ?? 1;
}
