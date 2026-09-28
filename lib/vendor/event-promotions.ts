// Vendor Side-Event Promotion — vendor-side data access.
// See Docs/plans/2026-09-28-0237-vendor-side-event-promotion.md.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { EventPromotionResubmit, EventPromotionSubmit } from '@/lib/validation/vendor-schemas';

export type EventPromotionStatus = 'pending' | 'approved' | 'paid' | 'rejected' | 'changes_requested';
export type EventPromotionPaymentMethod = 'wallet' | 'stripe';

export interface VendorEventPromotion {
  id: string;
  vendorId: string;
  title: string;
  details: string;
  startDate: string;
  endDate: string;
  posterUrl: string;
  status: EventPromotionStatus;
  rejectionReason: string | null;
  changesRequestedReason: string | null;
  amountSen: number | null;
  paymentMethod: EventPromotionPaymentMethod | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}

type EventPromotionRow = {
  id: string;
  vendor_id: string;
  title: string;
  details: string;
  starts_on: string;
  ends_on: string;
  poster_url: string;
  status: EventPromotionStatus;
  rejection_reason: string | null;
  changes_requested_reason: string | null;
  amount_sen: number | null;
  payment_method: EventPromotionPaymentMethod | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
};

function toEventPromotion(row: EventPromotionRow): VendorEventPromotion {
  return {
    id: row.id,
    vendorId: row.vendor_id,
    title: row.title,
    details: row.details,
    startDate: row.starts_on,
    endDate: row.ends_on,
    posterUrl: row.poster_url,
    status: row.status,
    rejectionReason: row.rejection_reason,
    changesRequestedReason: row.changes_requested_reason,
    amountSen: row.amount_sen,
    paymentMethod: row.payment_method,
    paidAt: row.paid_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_COLUMNS = 'id,vendor_id,title,details,starts_on,ends_on,poster_url,status,rejection_reason,changes_requested_reason,amount_sen,payment_method,paid_at,created_at,updated_at';

/** Inclusive day count x rate — mirrors the SQL in pay_vendor_event_promotion_from_wallet exactly. */
export function computeEventPromotionAmountSen(startDate: string, endDate: string, costPerDaySen: number): number {
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  const days = Math.round((end - start) / 86_400_000) + 1;
  return days * costPerDaySen;
}

export async function getMyEventPromotions(db: SupabaseClient, vendorId: string): Promise<VendorEventPromotion[]> {
  const { data, error } = await db
    .from('vendor_event_promotions')
    .select(SELECT_COLUMNS)
    .eq('vendor_id', vendorId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to load event promotions: ${error.message}`);
  return (data ?? []).map((row) => toEventPromotion(row as EventPromotionRow));
}

/**
 * Insert via the service client after authorizeVendor() has already scoped
 * the caller — same pattern as the vendor media upload route. The RLS insert
 * policy on vendor_event_promotions is defense-in-depth, not the primary gate.
 */
export async function submitEventPromotion(
  db: SupabaseClient,
  vendorId: string,
  submittedBy: string,
  input: EventPromotionSubmit,
): Promise<VendorEventPromotion> {
  const { data, error } = await db
    .from('vendor_event_promotions')
    .insert({
      vendor_id: vendorId,
      submitted_by: submittedBy,
      title: input.title,
      details: input.details,
      starts_on: input.startDate,
      ends_on: input.endDate,
      poster_url: input.posterUrl,
    })
    .select(SELECT_COLUMNS)
    .single();
  if (error) throw new Error(`Failed to submit event promotion: ${error.message}`);
  return toEventPromotion(data as EventPromotionRow);
}

/**
 * Calls the resubmit RPC via the AUTH-BOUND client (not the service client) —
 * the RPC is SECURITY DEFINER and checks auth.uid() internally, which only
 * resolves for a real user session, not a service-role call. Same pattern as
 * app/api/admin/recommendations/review/route.ts calling admin_review_recommendation.
 * Valid from 'changes_requested' or 'approved' (unpaid) only — the RPC itself
 * enforces this and raises 'not_editable' otherwise.
 */
export async function resubmitEventPromotion(
  authDb: SupabaseClient,
  promotionId: string,
  input: EventPromotionResubmit,
): Promise<{ ok: true } | { ok: false; code: 'not_found' | 'not_editable' | 'forbidden' | 'unknown' }> {
  const { error } = await authDb.rpc('resubmit_vendor_event_promotion', {
    p_promotion_id: promotionId,
    p_title: input.title,
    p_details: input.details,
    p_starts_on: input.startDate,
    p_ends_on: input.endDate,
    p_poster_url: input.posterUrl,
  });
  if (!error) return { ok: true };
  if (error.message.includes('not_found')) return { ok: false, code: 'not_found' };
  if (error.message.includes('not_editable')) return { ok: false, code: 'not_editable' };
  if (error.message.includes('forbidden')) return { ok: false, code: 'forbidden' };
  return { ok: false, code: 'unknown' };
}

/**
 * Debits the vendor's wallet earnings for the promotion fee. Auth-bound
 * client, same reasoning as resubmitEventPromotion — the RPC checks
 * auth.uid() to find the caller's own wallet.
 */
export async function payEventPromotionFromWallet(
  authDb: SupabaseClient,
  promotionId: string,
): Promise<
  | { ok: true; amountSen: number }
  | { ok: false; code: 'not_found' | 'not_payable' | 'forbidden' | 'wallet_not_found' | 'insufficient_earnings' | 'unknown' }
> {
  const { data, error } = await authDb.rpc('pay_vendor_event_promotion_from_wallet', {
    p_promotion_id: promotionId,
  });
  if (!error) return { ok: true, amountSen: Number(data) };
  if (error.message.includes('not_found')) return { ok: false, code: 'not_found' };
  if (error.message.includes('not_payable')) return { ok: false, code: 'not_payable' };
  if (error.message.includes('forbidden')) return { ok: false, code: 'forbidden' };
  if (error.message.includes('wallet_not_found')) return { ok: false, code: 'wallet_not_found' };
  if (error.message.includes('insufficient_earnings')) return { ok: false, code: 'insufficient_earnings' };
  return { ok: false, code: 'unknown' };
}

export interface EventPromotionDateAvailability {
  day: string;
  occupiedCount: number;
  available: boolean;
}

/**
 * Soft UX hint only — the real capacity gate is server-side in
 * review_vendor_event_promotion's approve branch. Any signed-in client
 * works here (SECURITY DEFINER RPC returning aggregates only).
 */
export async function getEventPromotionDateAvailability(
  db: SupabaseClient,
  from: string,
  to: string,
): Promise<EventPromotionDateAvailability[]> {
  const { data, error } = await db.rpc('get_event_promotion_date_availability', { p_from: from, p_to: to });
  if (error) throw new Error(`Failed to load event promotion availability: ${error.message}`);
  return (data ?? []).map((row: { day: string; occupied_count: number; available: boolean }) => ({
    day: row.day,
    occupiedCount: row.occupied_count,
    available: row.available,
  }));
}
