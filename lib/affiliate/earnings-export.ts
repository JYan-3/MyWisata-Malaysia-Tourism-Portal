// P4 — Member 4: affiliate earnings export. CLAUDE-P4-EXTRAS-2.md Extra 6.
//
// Deliberately NOT a reuse of getAffiliateStats() (lib/affiliate/stats.ts)
// even though the two overlap heavily — that function has no date-range
// filtering (the export needs "this month / this year / all", applied at
// the query level, not client-side after fetching everything) and returns
// a lot of aggregate data (byProduct, clicksByDay, funnel, tier) this export
// has no use for. Same building blocks are reused instead: resolveProductNames()
// and the same service-role orders lookup, for the same RLS-gap reason
// documented in stats.ts's file header (orders_own_or_admin has no
// affiliate-entitlement clause).

import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase/service';
import { resolveProductNames } from './product-names';
import { rangeCutoffIso, type EarningsExportRange } from './earnings-range';

const EXPORT_BATCH_SIZE = 500;
const MAX_EXPORT_ROWS = 20_000;

export type { EarningsExportRange };

export interface EarningsExportRow {
  date: string; // affiliate_attributions.created_at (ISO)
  productName: string;
  orderReference: string; // orders.display_id ("ORD-1234"), falls back to the raw order id
  orderAmount: number | null;
  /** The rate STAMPED on this attribution row at the time it was created —
   *  never recomputed from the affiliate's current tier. A past commission
   *  must show the rate it was actually paid at, even if the affiliate's
   *  tier (and therefore rate) has since changed. Fraction, e.g. 0.04. */
  commissionRate: number;
  commissionAmount: number;
  status: 'pending' | 'confirmed' | 'reversed' | 'rejected';
  clearedAt: string | null; // ISO, null while still pending/reversed
}


/**
 * `service` should be the caller's cookie-aware client — affiliate_links /
 * affiliate_clicks / affiliate_attributions all carry real own-row RLS
 * (migration 011), so scoping to `userId`'s own data is enforced by
 * Postgres itself, not just by this function filtering correctly. The
 * `userId` passed in must come from the authenticated session (the route
 * below does this), never from a request parameter — there is no "export
 * a different user's earnings" code path here at all, by construction.
 */
export async function* getAffiliateEarningsExportPages(
  service: SupabaseClient,
  userId: string,
  range: EarningsExportRange,
): AsyncGenerator<EarningsExportRow[], void, void> {
  const { data: links, error: linkError } = await service.from('affiliate_links').select('id').eq('user_id', userId);
  if (linkError) throw new Error('affiliate_earnings_export_unavailable');
  const linkIds = (links ?? []).map((link) => link.id);
  if (!linkIds.length) return;

  // ⚠️ confirmed_at, not just cleared_at: live-found while building this
  // export — affiliate_attributions carries TWO independent "when did this
  // clear" timestamps from two different clearing mechanisms that both
  // still exist. lib/affiliate/clearing.ts::clearMaturedCommissions() (the
  // one this whole module's docs describe as authoritative) sets cleared_at.
  // But migrations 014–016 also added an EARLIER, separate DB-level
  // confirm_pending_earnings() RPC — still live, still wired to a daily
  // Vercel Cron (app/api/cron/clear-earnings) and an admin route
  // (app/api/admin/clear-earnings) — which sets confirmed_at instead, gated
  // on a hold_until column the current onOrderPaid() never populates for
  // new rows. Net effect, confirmed live against real data: it's
  // structurally a no-op for anything created after Phase 2, but at least
  // one pre-Phase-2 row (status='confirmed', confirmed_at set, cleared_at
  // NULL) still exists from before the switch. Reading cleared_at alone
  // would show a blank "Cleared Date" for a row that IS genuinely
  // confirmed — wrong for a document whose whole purpose is financial
  // accuracy. Falls back to confirmed_at below. NOT attempting to reconcile
  // or retire either clearing mechanism here — well outside this extra's
  // scope — but this is worth someone owning deliberately, not by accident.
  const snapshotCutoff = new Date().toISOString();
  const rangeStart = rangeCutoffIso(range, new Date(snapshotCutoff));
  let countQuery = service
    .from('affiliate_attributions')
    .select('id, affiliate_clicks!inner(link_id)', { count: 'exact', head: true })
    .in('affiliate_clicks.link_id', linkIds)
    .lte('created_at', snapshotCutoff);
  if (rangeStart) countQuery = countQuery.gte('created_at', rangeStart);
  const { count, error: countError } = await countQuery;
  if (countError || count === null) throw new Error('affiliate_earnings_export_unavailable');
  if (count > MAX_EXPORT_ROWS) throw new Error('affiliate_earnings_export_limit_exceeded');

  let cursor: { createdAt: string; id: string } | null = null;
  const serviceClient = createServiceClient();

  for (;;) {
    let query = service
      .from('affiliate_attributions')
      .select('id, click_id, order_id, commission_rate, commission_amount, status, created_at, cleared_at, confirmed_at, affiliate_clicks!inner(target_type, target_id, link_id)')
      .in('affiliate_clicks.link_id', linkIds)
      .lte('created_at', snapshotCutoff)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(EXPORT_BATCH_SIZE + 1);
    if (rangeStart) query = query.gte('created_at', rangeStart);
    if (cursor) {
      query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
    }
    const { data, error } = await query;
    if (error) throw new Error('affiliate_earnings_export_unavailable');
    const batch = data ?? [];
    const hasMore = batch.length > EXPORT_BATCH_SIZE;
    const page = batch.slice(0, EXPORT_BATCH_SIZE);
    if (!page.length) break;
    // The order lookup is intentionally batch-local: order RLS does not
    // expose a buyer's amount to an affiliate, so use the service client.
    const orderIds = [...new Set(page.map((row) => row.order_id))];
    const [{ data: ordersData, error: ordersError }, productNames] = await Promise.all([
      serviceClient.from('orders').select('id, display_id, total_amount').in('id', orderIds),
      resolveProductNames([...new Set(page.flatMap((row) => {
        const click = Array.isArray(row.affiliate_clicks) ? row.affiliate_clicks[0] : row.affiliate_clicks;
        return click?.target_type === 'product' && click.target_id ? [click.target_id as string] : [];
      }))]),
    ]);
    if (ordersError) throw new Error('affiliate_earnings_export_unavailable');
    const ordersById = new Map((ordersData ?? []).map((order) => [order.id, order]));
    const rows: EarningsExportRow[] = [];
    for (const attribution of page) {
      const click = Array.isArray(attribution.affiliate_clicks)
        ? attribution.affiliate_clicks[0]
        : attribution.affiliate_clicks;
      const productId = click?.target_type === 'product' ? click.target_id : null;
      const order = ordersById.get(attribution.order_id);
      rows.push({
        date: attribution.created_at,
        productName: productId ? (productNames.get(productId) ?? 'Deleted listing') : 'Unknown',
        orderReference: order?.display_id ?? attribution.order_id,
        orderAmount: order ? Number(order.total_amount) : null,
        commissionRate: Number(attribution.commission_rate),
        commissionAmount: Number(attribution.commission_amount),
        status: attribution.status as EarningsExportRow['status'],
        clearedAt: attribution.cleared_at ?? attribution.confirmed_at,
      });
    }
    yield rows;
    if (!hasMore) break;
    const last = page.at(-1)!;
    cursor = { createdAt: last.created_at, id: last.id };
  }
}
