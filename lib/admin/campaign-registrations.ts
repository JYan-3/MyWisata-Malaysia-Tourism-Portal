// Vendor-Fair Event Participation — admin-side registration review.
// See Docs/plans/2026-09-28-1732-vendor-fair-event-participation.md.

import type { SupabaseClient } from '@supabase/supabase-js';
import { productImageUrl } from '@/lib/storage/product-image';

export type CampaignRegistrationStatus = 'pending' | 'approved' | 'rejected' | 'changes_requested' | 'withdrawn' | 'removed';

export interface AdminCampaignProduct {
  id: string;
  name: string;
  price: number;
  imageUrl: string | null;
  itemKind: 'product' | 'service';
  dailyQuantity: number;
  active: boolean;
}

export interface AdminCampaignRegistration {
  id: string;
  campaignId: string;
  campaignTitle: string;
  vendorId: string;
  vendorName: string;
  locationName: string;
  locationStartsOn: string | null;
  locationEndsOn: string | null;
  stallNumber: string;
  stallDescription: string;
  stallPosterUrl: string;
  status: CampaignRegistrationStatus;
  rejectionReason: string | null;
  changesRequestedReason: string | null;
  /** Why a withdrawn or removed stall was closed. */
  closedReason: string | null;
  products: AdminCampaignProduct[];
  createdAt: string;
}

type RegistrationRow = {
  id: string;
  campaign_id: string;
  vendor_id: string;
  stall_number: string;
  stall_description: string;
  stall_poster_url: string;
  status: CampaignRegistrationStatus;
  rejection_reason: string | null;
  changes_requested_reason: string | null;
  closed_reason: string | null;
  created_at: string;
  vendors: { name: string } | { name: string }[] | null;
  promotion_campaigns: { title: string } | { title: string }[] | null;
  location: LocationEmbed | LocationEmbed[] | null;
};

type LocationEmbed = { name: string; starts_on: string; ends_on: string };

type ProductRow = {
  id: string;
  registration_id: string;
  position: number;
  name: string | null;
  price: number | null;
  image_url: string | null;
  item_kind: 'product' | 'service';
  daily_quantity: number;
  active: boolean;
  products: { name: string; base_price: number; cover_url: string | null } | { name: string; base_price: number; cover_url: string | null }[] | null;
};

function single<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

const REGISTRATION_COLUMNS = 'id,campaign_id,vendor_id,stall_number,stall_description,stall_poster_url,status,rejection_reason,changes_requested_reason,closed_reason,created_at,vendors(name),promotion_campaigns(title),location:promotion_campaign_locations(name,starts_on,ends_on)';
const PRODUCT_COLUMNS = 'id,registration_id,position,name,price,image_url,item_kind,daily_quantity,active,products(name,base_price,cover_url)';

function toProduct(row: ProductRow): AdminCampaignProduct {
  const product = single(row.products);
  return {
    id: row.id,
    name: product?.name ?? row.name ?? '',
    price: Number(row.price ?? product?.base_price ?? 0),
    imageUrl: productImageUrl(product?.cover_url ?? row.image_url),
    itemKind: row.item_kind,
    dailyQuantity: row.daily_quantity,
    active: row.active,
  };
}

function toRegistration(row: RegistrationRow, products: AdminCampaignProduct[]): AdminCampaignRegistration {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    campaignTitle: single(row.promotion_campaigns)?.title ?? '',
    vendorId: row.vendor_id,
    vendorName: single(row.vendors)?.name ?? 'Unknown vendor',
    locationName: single(row.location)?.name ?? '',
    locationStartsOn: single(row.location)?.starts_on ?? null,
    locationEndsOn: single(row.location)?.ends_on ?? null,
    stallNumber: row.stall_number,
    stallDescription: row.stall_description,
    stallPosterUrl: row.stall_poster_url,
    status: row.status,
    rejectionReason: row.rejection_reason,
    changesRequestedReason: row.changes_requested_reason,
    closedReason: row.closed_reason,
    products,
    createdAt: row.created_at,
  };
}

async function loadProducts(db: SupabaseClient, registrationIds: string[]): Promise<Map<string, AdminCampaignProduct[]>> {
  const byRegistration = new Map<string, AdminCampaignProduct[]>();
  if (registrationIds.length === 0) return byRegistration;
  const { data, error } = await db.from('promotion_campaign_vendor_products')
    .select(PRODUCT_COLUMNS)
    .in('registration_id', registrationIds)
    .order('position', { ascending: true });
  if (error) throw new Error(`Failed to load registration products: ${error.message}`);
  for (const row of (data ?? []) as unknown as ProductRow[]) {
    const list = byRegistration.get(row.registration_id) ?? [];
    list.push(toProduct(row));
    byRegistration.set(row.registration_id, list);
  }
  return byRegistration;
}

export async function listCampaignRegistrations(db: SupabaseClient, status?: CampaignRegistrationStatus): Promise<AdminCampaignRegistration[]> {
  let query = db.from('promotion_campaign_vendors').select(REGISTRATION_COLUMNS).order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to load campaign registrations: ${error.message}`);
  const rows = (data ?? []) as unknown as RegistrationRow[];
  const productsByRegistration = await loadProducts(db, rows.map((row) => row.id));
  return rows.map((row) => toRegistration(row, productsByRegistration.get(row.id) ?? []));
}

export async function getCampaignRegistration(db: SupabaseClient, id: string): Promise<AdminCampaignRegistration | null> {
  const { data, error } = await db.from('promotion_campaign_vendors').select(REGISTRATION_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to load campaign registration: ${error.message}`);
  if (!data) return null;
  const row = data as unknown as RegistrationRow;
  const productsByRegistration = await loadProducts(db, [row.id]);
  return toRegistration(row, productsByRegistration.get(row.id) ?? []);
}

export type ReviewAction = 'approve' | 'reject' | 'request_changes';

export async function reviewCampaignRegistration(
  authDb: SupabaseClient,
  registrationId: string,
  action: ReviewAction,
  note?: string,
): Promise<{ ok: true } | { ok: false; code: 'not_found' | 'not_pending' | 'admin_required' | 'note_required' | 'unknown' }> {
  const { error } = await authDb.rpc('review_campaign_vendor_registration', {
    p_registration_id: registrationId,
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
