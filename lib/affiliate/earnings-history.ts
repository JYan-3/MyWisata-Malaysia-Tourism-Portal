import type { SupabaseClient } from '@supabase/supabase-js';
import { getClearanceDays } from './settings';
import { rangeCutoffIso, type EarningsExportRange } from './earnings-range';
import { resolveProductNames } from './product-names';
import type { AffiliateCommission } from './stats';

export interface AffiliateEarningsPage {
  snapshotCutoff: string;
  totalCount: number;
  pageSize: 10 | 25 | 50;
  hasMore: boolean;
  nextCursor: { createdAt: string; id: string } | null;
  pendingAmount: number;
  totalAmount: number;
  commissions: AffiliateCommission[];
}

export interface AffiliateEarningsPageQuery {
  range: EarningsExportRange;
  pageSize: 10 | 25 | 50;
  snapshotCutoff?: string;
  cursor?: { createdAt: string; id: string } | null;
}

export async function getAffiliateEarningsPage(
  service: SupabaseClient,
  userId: string,
  query: AffiliateEarningsPageQuery,
): Promise<AffiliateEarningsPage> {
  const snapshotCutoff = query.snapshotCutoff ?? new Date().toISOString();
  const { data, error } = await service.rpc('get_affiliate_earnings_page', {
    p_user_id: userId,
    p_since: rangeCutoffIso(query.range, new Date(snapshotCutoff)),
    p_snapshot_cutoff: snapshotCutoff,
    p_page_size: query.pageSize,
    p_before_created_at: query.cursor?.createdAt ?? null,
    p_before_id: query.cursor?.id ?? null,
  });
  if (error || !data || typeof data !== 'object') throw new Error('affiliate_earnings_history_unavailable');

  const result = data as {
    snapshotCutoff: string;
    totalCount: number;
    pageSize: 10 | 25 | 50;
    hasMore: boolean;
    nextCursor: AffiliateEarningsPage['nextCursor'];
    pendingAmount: number;
    totalAmount: number;
    commissions: Array<{
      id: string;
      targetType: string | null;
      targetId: string | null;
      displayId: string | null;
      orderAmount: number | string | null;
      rate: number | string;
      amount: number | string;
      status: string;
      createdAt: string;
      clearedAt: string | null;
    }>;
  };
  const productIds = [...new Set(result.commissions
    .filter((row) => row.targetType === 'product' && row.targetId)
    .map((row) => row.targetId as string))];
  const [productNames, clearanceDays] = await Promise.all([
    resolveProductNames(productIds),
    getClearanceDays(service),
  ]);
  const commissions: AffiliateCommission[] = result.commissions.map((row) => {
    const createdAtMs = new Date(row.createdAt).getTime();
    const clearsInDays = row.status === 'pending'
      ? Math.max(0, Math.ceil(clearanceDays - (Date.now() - createdAtMs) / 86_400_000))
      : null;
    return {
      id: row.id,
      productName: row.targetType === 'product' && row.targetId
        ? productNames.get(row.targetId) ?? 'Deleted listing'
        : null,
      orderAmount: row.orderAmount === null ? null : Number(row.orderAmount),
      rate: Number(row.rate),
      amount: Number(row.amount),
      status: row.status as AffiliateCommission['status'],
      createdAt: row.createdAt,
      clearedAt: row.clearedAt,
      clearsInDays,
    };
  });
  return { ...result, commissions };
}
