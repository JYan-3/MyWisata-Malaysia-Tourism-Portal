// Vendor Side-Event Promotion — admin-side data access.
// See Docs/plans/2026-09-28-0237-vendor-side-event-promotion.md.

import type { SupabaseClient } from '@supabase/supabase-js';

export type EventPromotionStatus = 'pending' | 'approved' | 'paid' | 'rejected' | 'changes_requested' | 'paused';
export type EventPromotionPaymentMethod = 'wallet' | 'stripe';

export interface AdminEventPromotion {
  id: string;
  vendorId: string;
  vendorName: string;
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
}

type AdminEventPromotionRow = {
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
  vendors: { name: string } | { name: string }[] | null;
};

function vendorName(vendors: AdminEventPromotionRow['vendors']): string {
  const row = Array.isArray(vendors) ? vendors[0] : vendors;
  return row?.name ?? 'Unknown vendor';
}

function toAdminEventPromotion(row: AdminEventPromotionRow): AdminEventPromotion {
  return {
    id: row.id,
    vendorId: row.vendor_id,
    vendorName: vendorName(row.vendors),
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
  };
}

const SELECT_COLUMNS = 'id,vendor_id,title,details,starts_on,ends_on,poster_url,status,rejection_reason,changes_requested_reason,amount_sen,payment_method,paid_at,created_at,vendors(name)';

export async function listEventPromotions(db: SupabaseClient, status?: EventPromotionStatus): Promise<AdminEventPromotion[]> {
  let query = db.from('vendor_event_promotions').select(SELECT_COLUMNS).order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to load event promotions: ${error.message}`);
  return (data ?? []).map((row) => toAdminEventPromotion(row as unknown as AdminEventPromotionRow));
}

export async function getEventPromotion(db: SupabaseClient, id: string): Promise<AdminEventPromotion | null> {
  const { data, error } = await db.from('vendor_event_promotions').select(SELECT_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to load event promotion: ${error.message}`);
  return data ? toAdminEventPromotion(data as unknown as AdminEventPromotionRow) : null;
}

export type ReviewAction = 'approve' | 'reject' | 'request_changes';

export async function reviewEventPromotion(
  authDb: SupabaseClient,
  promotionId: string,
  action: ReviewAction,
  note?: string,
): Promise<{ ok: true } | { ok: false; code: 'not_found' | 'not_pending' | 'admin_required' | 'note_required' | 'unknown' }> {
  const { error } = await authDb.rpc('review_vendor_event_promotion', {
    p_promotion_id: promotionId,
    p_action: action,
    p_note: note ?? null,
  });
  if (!error) return { ok: true };
  if (error.message.includes('not_found')) return { ok: false, code: 'not_found' };
  if (error.message.includes('not_pending')) return { ok: false, code: 'not_pending' };
  if (error.message.includes('admin_required')) return { ok: false, code: 'admin_required' };
  if (error.message.includes('note_required')) return { ok: false, code: 'note_required' };
  return { ok: false, code: 'unknown' };
}

export type VisibilityAction = 'pause' | 'resume';

export async function setEventPromotionVisibility(
  authDb: SupabaseClient,
  promotionId: string,
  action: VisibilityAction,
): Promise<
  | { ok: true }
  | { ok: false; code: 'not_found' | 'not_paid' | 'not_paused' | 'promotion_ended' | 'capacity_exceeded' | 'admin_required' | 'unknown' }
> {
  const { error } = await authDb.rpc('set_vendor_event_promotion_visibility', {
    p_promotion_id: promotionId,
    p_action: action,
  });
  if (!error) return { ok: true };
  if (error.message.includes('not_found')) return { ok: false, code: 'not_found' };
  if (error.message.includes('not_paid')) return { ok: false, code: 'not_paid' };
  if (error.message.includes('not_paused')) return { ok: false, code: 'not_paused' };
  if (error.message.includes('promotion_ended')) return { ok: false, code: 'promotion_ended' };
  if (error.message.includes('capacity_exceeded')) return { ok: false, code: 'capacity_exceeded' };
  if (error.message.includes('admin_required')) return { ok: false, code: 'admin_required' };
  return { ok: false, code: 'unknown' };
}

// ── Cost-per-day setting ────────────────────────────────────────────────
// Same platform_settings key/value shape as commission.platform_rate; no
// generic settings framework exists here, matching app/api/admin/wallet-settings.

const COST_PER_DAY_KEY = 'event_promotion.cost_per_day_sen';
const COST_PER_DAY_DEFAULT_SEN = 10_000;

export async function getEventPromotionCostPerDaySen(db: SupabaseClient): Promise<number> {
  const { data, error } = await db.from('platform_settings').select('value').eq('key', COST_PER_DAY_KEY).maybeSingle();
  if (error) throw new Error(`Failed to load event promotion cost setting: ${error.message}`);
  const parsed = data ? Number(data.value) : NaN;
  return Number.isFinite(parsed) ? parsed : COST_PER_DAY_DEFAULT_SEN;
}

export async function setEventPromotionCostPerDaySen(db: SupabaseClient, costPerDaySen: number, updatedBy: string): Promise<void> {
  const { error } = await db.from('platform_settings').upsert(
    { key: COST_PER_DAY_KEY, value: String(costPerDaySen), updated_by: updatedBy },
    { onConflict: 'key' },
  );
  if (error) throw new Error(`Failed to update event promotion cost setting: ${error.message}`);
}

// ── Max-concurrent-promotions cap ───────────────────────────────────────
// Same platform_settings key/value shape as cost-per-day above. Enforced
// server-side in review_vendor_event_promotion's approve branch
// (20260928050000_vendor_event_promotion_capacity.sql); this getter/setter
// pair is only for the admin settings UI to read/edit the configured value.

const MAX_CONCURRENT_KEY = 'event_promotion.max_concurrent';
const MAX_CONCURRENT_DEFAULT = 4;

export async function getEventPromotionMaxConcurrent(db: SupabaseClient): Promise<number> {
  const { data, error } = await db.from('platform_settings').select('value').eq('key', MAX_CONCURRENT_KEY).maybeSingle();
  if (error) throw new Error(`Failed to load event promotion capacity setting: ${error.message}`);
  const parsed = data ? Number(data.value) : NaN;
  return Number.isFinite(parsed) ? parsed : MAX_CONCURRENT_DEFAULT;
}

export async function setEventPromotionMaxConcurrent(db: SupabaseClient, maxConcurrent: number, updatedBy: string): Promise<void> {
  const { error } = await db.from('platform_settings').upsert(
    { key: MAX_CONCURRENT_KEY, value: String(maxConcurrent), updated_by: updatedBy },
    { onConflict: 'key' },
  );
  if (error) throw new Error(`Failed to update event promotion capacity setting: ${error.message}`);
}
