// P4 — vendor order settlement, read + wire helpers.
//
// The money path itself is DB-owned (migration 20260911000000): the RPCs
// settle_order_vendor_earnings / clear_matured_vendor_settlements /
// reverse_order_vendor_settlement do all wallet movement. This module is the
// thin server wrappers that call them post-payment (mirroring how
// lib/affiliate/attribution.ts::onOrderPaid is wired) and the read side for
// the vendor-facing panel.

import type { SupabaseClient } from '@supabase/supabase-js';
import { add } from '@/lib/money';
import type { VendorFeeSummary } from '@/lib/vendor/fee-tiers';

export interface VendorSettlementRow {
  id: string;
  orderId: string;
  orderDisplayId: string | null;
  grossSen: number;
  platformFeeSen: number;
  vendorNetSen: number;
  platformRate: number;
  /** How the fee was charged (snapshot): 'percent' of the sale, 'fixed' per item, or both. */
  feeType?: 'percent' | 'fixed' | 'mixed';
  /** 'event' when items came from an event page (event fee per item). */
  feeSource?: 'tier' | 'event' | 'mixed';
  feePerItemSen?: number | null;
  itemCount?: number | null;
  /** Set when the fee was raised to cover referral payouts on the order. */
  payoutFloorApplied?: boolean;
  status: 'pending' | 'confirmed' | 'reversed';
  isSimulated?: boolean;
  /** Days until a pending settlement's hold matures, floored at 0. null unless pending. */
  clearsInDays: number | null;
  createdAt: string;
}

export interface VendorSettlements {
  totals: {
    /** Σ vendor net still held (RM sen). */
    pendingSen: number;
    /** Σ vendor net already cleared to the spendable wallet (RM sen). */
    clearedSen: number;
    /** Σ platform commission taken across all non-reversed settlements (RM sen). */
    lifetimePlatformFeesSen: number;
  };
  settlements: VendorSettlementRow[];
  /** The vendor's current tier and fee (added by GET /api/vendor/settlements). */
  fee?: VendorFeeSummary | null;
}

const EMPTY: VendorSettlements = {
  totals: { pendingSen: 0, clearedSen: 0, lifetimePlatformFeesSen: 0 },
  settlements: [],
};

type Row = {
  id: string;
  order_id: string;
  gross_sen: number | string;
  platform_fee_sen: number | string;
  vendor_net_sen: number | string;
  platform_rate: number | string;
  fee_type?: string;
  fee_source?: string;
  fee_per_item_sen?: number | string | null;
  item_count?: number | null;
  base_fee_sen?: number | string;
  status: string;
  is_simulated?: boolean;
  hold_until: string | null;
  reversed_amount_sen: number | string;
  created_at: string;
  orders: { display_id: string | null } | null;
};

function clearsInDays(holdUntil: string | null): number | null {
  if (!holdUntil) return null;
  return Math.max(0, Math.ceil((new Date(holdUntil).getTime() - Date.now()) / 86_400_000));
}

/** `service` may be the cookie-aware client — order_settlements has an own-vendor SELECT policy. */
export async function getVendorSettlements(
  service: SupabaseClient,
  vendorId: string,
): Promise<VendorSettlements> {
  const { data, error } = await service
    .from('order_settlements')
    .select('id, order_id, gross_sen, platform_fee_sen, vendor_net_sen, platform_rate, fee_type, fee_source, fee_per_item_sen, item_count, base_fee_sen, status, is_simulated, hold_until, reversed_amount_sen, created_at, orders(display_id)')
    .eq('vendor_id', vendorId)
    .order('created_at', { ascending: false });

  if (error || !data) return EMPTY;
  const rows = data as unknown as Row[];

  const settlements: VendorSettlementRow[] = rows.map((row) => {
    const status = row.status === 'confirmed' || row.status === 'reversed' ? row.status : 'pending';
    return {
      id: row.id,
      orderId: row.order_id,
      orderDisplayId: row.orders?.display_id ?? null,
      grossSen: Number(row.gross_sen),
      platformFeeSen: Number(row.platform_fee_sen),
      vendorNetSen: Number(row.vendor_net_sen),
      platformRate: Number(row.platform_rate),
      feeType: row.fee_type === 'fixed' || row.fee_type === 'mixed' ? row.fee_type : 'percent',
      feeSource: row.fee_source === 'event' || row.fee_source === 'mixed' ? row.fee_source : 'tier',
      feePerItemSen: row.fee_per_item_sen == null ? null : Number(row.fee_per_item_sen),
      itemCount: row.item_count ?? null,
      payoutFloorApplied: row.base_fee_sen != null && Number(row.platform_fee_sen) > Number(row.base_fee_sen),
      status,
      isSimulated: Boolean(row.is_simulated),
      clearsInDays: status === 'pending' ? clearsInDays(row.hold_until) : null,
      createdAt: row.created_at,
    };
  });

  const netFor = (r: Row) => Number(r.vendor_net_sen) - Number(r.reversed_amount_sen);
  const totals = {
    pendingSen: rows.filter((r) => r.status === 'pending' && !r.is_simulated).reduce((s, r) => add(s, netFor(r)), 0),
    clearedSen: rows.filter((r) => r.status === 'confirmed' && !r.is_simulated).reduce((s, r) => add(s, netFor(r)), 0),
    lifetimePlatformFeesSen: rows.filter((r) => r.status !== 'reversed' && !r.is_simulated).reduce((s, r) => add(s, Number(r.platform_fee_sen)), 0),
  };

  return { totals, settlements };
}

/**
 * Credits every vendor on a paid order their held net share, minus platform
 * commission. Idempotent (order_settlements unique key). Never throws — a
 * settlement failure must not misrepresent a completed payment; the
 * wallet-maintenance backstop re-settles any order this missed.
 */
export async function settleOrderVendorEarnings(service: SupabaseClient, orderId: string): Promise<boolean> {
  try {
    const { data, error } = await service.rpc('settle_order_vendor_earnings', { p_order_id: orderId });
    if (error) console.error('[vendor-settlement] settle failed', orderId, error.message);
    return !error && Number(data?.settled ?? 0) > 0;
  } catch (err) {
    console.error('[vendor-settlement] settle threw', orderId, err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Raises (or releases) a pending settlement's platform fee so it always covers
 * the affiliate + recommendation payouts the order owes. Idempotent; run after
 * those payouts are created or rejected. Never throws.
 */
export async function applyOrderPlatformFeeFloor(service: SupabaseClient, orderId: string): Promise<void> {
  try {
    const { error } = await service.rpc('apply_order_platform_fee_floor', { p_order_id: orderId });
    if (error) console.error('[vendor-settlement] fee floor failed', orderId, error.message);
  } catch (err) {
    console.error('[vendor-settlement] fee floor threw', orderId, err instanceof Error ? err.message : err);
  }
}

/** Claws back the refunded fraction of a vendor's settlement (confirmed rows / partial refunds). */
export async function reverseOrderVendorSettlement(
  service: SupabaseClient,
  orderId: string,
  refundAmountSen?: number,
): Promise<boolean> {
  try {
    const { data, error } = await service.rpc('reverse_order_vendor_settlement', {
      p_order_id: orderId,
      p_refund_amount_sen: refundAmountSen ?? null,
    });
    if (error) console.error('[vendor-settlement] reverse failed', orderId, error.message);
    return !error && Number(data?.reversed ?? 0) > 0;
  } catch (err) {
    console.error('[vendor-settlement] reverse threw', orderId, err instanceof Error ? err.message : err);
    return false;
  }
}

export interface VendorSettlementMaintenanceResult {
  cleared: number;
  reversed: number;
  backfilled: number;
  clawedBack: number;
  failed: number;
  /** Vendors whose fee tier changed in tonight's 90-day sales placement. */
  feeTiersMoved?: number;
}

/**
 * Authoritative reconciliation pass for the wallet-maintenance cron. The
 * post-payment wire is best-effort; this is what guarantees every paid order
 * eventually settles and every refunded order eventually claws back.
 */
export async function runVendorSettlementMaintenance(
  service: SupabaseClient,
): Promise<VendorSettlementMaintenanceResult> {
  const result: VendorSettlementMaintenanceResult = { cleared: 0, reversed: 0, backfilled: 0, clawedBack: 0, failed: 0 };

  const { data: moved, error: tierError } = await service.rpc('recompute_vendor_fee_tiers');
  if (tierError) result.failed += 1;
  else result.feeTiersMoved = Number(moved ?? 0);

  // Re-check the payout floor before held money clears: a referral payout may
  // have been attributed late, or rejected by an admin, since settlement.
  const { data: held, error: heldError } = await service.from('order_settlements').select('order_id').eq('status', 'pending');
  if (heldError) result.failed += 1;
  for (const orderId of new Set(((held ?? []) as { order_id: string }[]).map((row) => row.order_id))) {
    await applyOrderPlatformFeeFloor(service, orderId);
  }

  const { data: matured, error: maturityError } = await service.rpc('clear_matured_vendor_settlements');
  if (maturityError) result.failed += 1;
  for (const row of (matured ?? []) as { action: string }[]) {
    if (row.action === 'cleared') result.cleared += 1;
    else if (row.action === 'reversed') result.reversed += 1;
  }

  // Stable keyset pages cover old orders without a fourteen-day cutoff.
  let cursor: string | null = null;
  do {
    let query = service.from('orders').select('id, order_settlements(order_id)')
      .in('status', ['paid', 'completed']).order('id', { ascending: true }).limit(500);
    if (cursor) query = query.gt('id', cursor);
    const { data, error } = await query;
    if (error) { result.failed += 1; break; }
    const orders = (data ?? []) as { id: string; order_settlements: unknown[] }[];
    for (const order of orders) {
      if ((order.order_settlements ?? []).length === 0) {
        if (await settleOrderVendorEarnings(service, order.id)) result.backfilled += 1;
        else result.failed += 1;
      }
    }
    cursor = orders.length === 500 ? orders[orders.length - 1].id : null;
  } while (cursor);

  cursor = null;
  const seen = new Set<string>();
  do {
    let query = service.from('order_settlements')
      .select('id, order_id, vendor_net_sen, reversed_amount_sen, orders!inner(status)')
      .eq('status', 'confirmed').eq('is_simulated', false).in('orders.status', ['refunded', 'cancelled'])
      .order('id', { ascending: true }).limit(500);
    if (cursor) query = query.gt('id', cursor);
    const { data, error } = await query;
    if (error) { result.failed += 1; break; }
    const rows = (data ?? []) as { id: string; order_id: string; vendor_net_sen: number; reversed_amount_sen: number }[];
    for (const row of rows) {
      if (Number(row.reversed_amount_sen) >= Number(row.vendor_net_sen) || seen.has(row.order_id)) continue;
      seen.add(row.order_id);
      if (await reverseOrderVendorSettlement(service, row.order_id)) result.clawedBack += 1;
      else result.failed += 1;
    }
    cursor = rows.length === 500 ? rows[rows.length - 1].id : null;
  } while (cursor);

  return result;
}
