// Vendor-Fair Event Participation — vendor-side data access.
// See Docs/plans/2026-09-28-1732-vendor-fair-event-participation.md.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CampaignRegistrationResubmit, CampaignRegistrationSubmit } from '@/lib/validation/vendor-schemas';

export type CampaignRegistrationStatus = 'pending' | 'approved' | 'rejected' | 'changes_requested';

export interface VendorCampaignProduct {
  id: string;
  name: string;
  price: number;
  imageUrl: string | null;
  /** null for a picked existing catalog product, the source product id otherwise absent — see productId below. */
  productId: string | null;
}

export interface VendorCampaignRegistration {
  id: string;
  campaignId: string;
  campaignTitle: string;
  vendorId: string;
  stallNumber: string;
  stallDescription: string;
  stallPosterUrl: string;
  status: CampaignRegistrationStatus;
  rejectionReason: string | null;
  changesRequestedReason: string | null;
  products: VendorCampaignProduct[];
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
  created_at: string;
  promotion_campaigns: { title: string } | { title: string }[] | null;
};

type ProductRow = {
  id: string;
  registration_id: string;
  product_id: string | null;
  name: string | null;
  price: number | null;
  image_url: string | null;
  position: number;
  products: { name: string; base_price: number; cover_url: string | null } | { name: string; base_price: number; cover_url: string | null }[] | null;
};

function single<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

const REGISTRATION_COLUMNS = 'id,campaign_id,vendor_id,stall_number,stall_description,stall_poster_url,status,rejection_reason,changes_requested_reason,created_at,promotion_campaigns(title)';
const PRODUCT_COLUMNS = 'id,registration_id,product_id,name,price,image_url,position,products(name,base_price,cover_url)';

function toProduct(row: ProductRow): VendorCampaignProduct {
  const product = single(row.products);
  return {
    id: row.id,
    name: product?.name ?? row.name ?? '',
    price: product?.base_price ?? row.price ?? 0,
    imageUrl: product?.cover_url ?? row.image_url,
    productId: row.product_id,
  };
}

async function loadProducts(db: SupabaseClient, registrationIds: string[]): Promise<Map<string, VendorCampaignProduct[]>> {
  const byRegistration = new Map<string, VendorCampaignProduct[]>();
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

function toRegistration(row: RegistrationRow, products: VendorCampaignProduct[]): VendorCampaignRegistration {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    campaignTitle: single(row.promotion_campaigns)?.title ?? '',
    vendorId: row.vendor_id,
    stallNumber: row.stall_number,
    stallDescription: row.stall_description,
    stallPosterUrl: row.stall_poster_url,
    status: row.status,
    rejectionReason: row.rejection_reason,
    changesRequestedReason: row.changes_requested_reason,
    products,
    createdAt: row.created_at,
  };
}

export async function getMyCampaignRegistrations(db: SupabaseClient, vendorId: string): Promise<VendorCampaignRegistration[]> {
  const { data, error } = await db
    .from('promotion_campaign_vendors')
    .select(REGISTRATION_COLUMNS)
    .eq('vendor_id', vendorId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to load campaign registrations: ${error.message}`);
  const rows = (data ?? []) as unknown as RegistrationRow[];
  const productsByRegistration = await loadProducts(db, rows.map((row) => row.id));
  return rows.map((row) => toRegistration(row, productsByRegistration.get(row.id) ?? []));
}

function toProductPayload(products: CampaignRegistrationSubmit['products']) {
  return products.map((product) => product.kind === 'existing'
    ? { productId: product.productId }
    : { name: product.name, price: product.price, imageUrl: product.imageUrl });
}

/**
 * Submits via the SECURITY DEFINER RPC (not a plain insert) — it needs to
 * atomically write the registration plus every product row, and validate
 * each picked product actually belongs to this vendor. Auth-bound client:
 * the RPC checks auth.uid() for ownership itself.
 */
export async function submitCampaignRegistration(
  authDb: SupabaseClient,
  campaignId: string,
  vendorId: string,
  input: CampaignRegistrationSubmit,
): Promise<{ ok: true; id: string } | { ok: false; code: 'forbidden' | 'campaign_not_open' | 'already_registered' | 'invalid' | 'unknown' }> {
  const { data, error } = await authDb.rpc('submit_campaign_vendor_registration', {
    p_campaign_id: campaignId,
    p_vendor_id: vendorId,
    p_stall_number: input.stallNumber,
    p_stall_description: input.stallDescription,
    p_stall_poster_url: input.stallPosterUrl,
    p_products: toProductPayload(input.products),
  });
  if (!error) return { ok: true, id: data as string };
  if (error.message.includes('forbidden')) return { ok: false, code: 'forbidden' };
  if (error.message.includes('campaign_not_open')) return { ok: false, code: 'campaign_not_open' };
  if (error.message.includes('already_registered')) return { ok: false, code: 'already_registered' };
  if (error.message.includes('invalid') || error.message.includes('required') || error.message.includes('not_owned')) return { ok: false, code: 'invalid' };
  return { ok: false, code: 'unknown' };
}

export async function resubmitCampaignRegistration(
  authDb: SupabaseClient,
  registrationId: string,
  input: CampaignRegistrationResubmit,
): Promise<{ ok: true } | { ok: false; code: 'not_found' | 'not_editable' | 'forbidden' | 'invalid' | 'unknown' }> {
  const { error } = await authDb.rpc('resubmit_campaign_vendor_registration', {
    p_registration_id: registrationId,
    p_stall_number: input.stallNumber,
    p_stall_description: input.stallDescription,
    p_stall_poster_url: input.stallPosterUrl,
    p_products: toProductPayload(input.products),
  });
  if (!error) return { ok: true };
  if (error.message.includes('not_found')) return { ok: false, code: 'not_found' };
  if (error.message.includes('not_editable')) return { ok: false, code: 'not_editable' };
  if (error.message.includes('forbidden')) return { ok: false, code: 'forbidden' };
  if (error.message.includes('invalid') || error.message.includes('required') || error.message.includes('not_owned')) return { ok: false, code: 'invalid' };
  return { ok: false, code: 'unknown' };
}
