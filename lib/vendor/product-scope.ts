import type { SupabaseClient } from '@supabase/supabase-js';
import type { OutletPageDocument } from '@/lib/vendor/outlet-page-schema';

type OutletSummary = { id: string; name?: string | null };

export type ProductOutletCandidate = {
  outlet_id: string | null;
  status?: string | null;
  outlets?: OutletSummary | OutletSummary[] | null;
  outlet_offers?: Array<{
    outlet_id: string;
    status?: string | null;
    outlets?: OutletSummary | OutletSummary[] | null;
  }> | null;
};

function relation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

export function resolveProductOutlet(product: ProductOutletCandidate, outletIds: string[]): OutletSummary | null {
  const allowed = new Set(outletIds);
  const directOutlet = relation(product.outlets);
  if (product.outlet_id && allowed.has(product.outlet_id)) return directOutlet || { id: product.outlet_id };

  const offer = (product.outlet_offers || []).find((candidate) => allowed.has(candidate.outlet_id) && candidate.status !== 'inactive');
  return offer ? relation(offer.outlets) || { id: offer.outlet_id } : null;
}

export function isVisibleActiveProduct(product: ProductOutletCandidate, outletIds: string[]) {
  return product.status === 'active' && resolveProductOutlet(product, outletIds) !== null;
}

export function isRatingEligibleProduct(product: ProductOutletCandidate, outletIds: string[]) {
  return isVisibleActiveProduct(product, outletIds);
}

export function filterProductsByOutlet<T extends ProductOutletCandidate>(products: T[], outletId: string): T[] {
  return products.filter((product) => resolveProductOutlet(product, [outletId]) !== null);
}

export function sanitizeOutletPageProductSelections(
  document: OutletPageDocument,
  availableProductIds: Set<string>,
): OutletPageDocument {
  return {
    ...document,
    featuredIds: document.featuredIds.filter((id) => availableProductIds.has(id)),
    blocks: document.blocks.map((block) =>
      block.productIds
        ? { ...block, productIds: block.productIds.filter((id) => availableProductIds.has(id)) }
        : block,
    ),
  };
}

export async function getScopedProduct<T extends Record<string, unknown>>(
  serviceDb: SupabaseClient,
  vendorId: string,
  productId: string,
  outletIds: string[],
  select: string,
): Promise<{ data: (T & ProductOutletCandidate) | null; outlet: OutletSummary | null; error: unknown }> {
  if (!outletIds.length) return { data: null, outlet: null, error: null };

  const selection = `${select.trim()},outlet_offers(outlet_id,status,outlets(id,name,city,state))`;
  const { data, error } = await serviceDb
    .from('products')
    .select(selection)
    .eq('id', productId)
    .eq('vendor_id', vendorId)
    .or(`outlet_id.in.(${outletIds.join(',')}),outlet_id.is.null`)
    .maybeSingle();

  if (error || !data) return { data: null, outlet: null, error };
  const product = data as unknown as T & ProductOutletCandidate;
  const outlet = resolveProductOutlet(product, outletIds);
  if (!outlet) return { data: null, outlet: null, error: null };
  const scoped = scopeProductOutletData(product, outletIds);
  return { data: scoped, outlet, error: null };
}


export function scopeProductOutletData<T extends Record<string, unknown> & ProductOutletCandidate>(product: T, outletIds: string[]): T {
  const allowed = new Set(outletIds);
  const scoped = { ...product, outlet_offers: product.outlet_offers?.filter((offer) => allowed.has(offer.outlet_id)) };
  if (Array.isArray(product.booking_slots)) {
    Object.assign(scoped, { booking_slots: product.booking_slots.filter((slot) => allowed.has(slot.outlet_id)) });
  }
  if (Array.isArray(product.product_variants)) {
    Object.assign(scoped, { product_variants: product.product_variants.map((variant) => ({
      ...variant,
      ...(Array.isArray(variant.inventory) ? { inventory: variant.inventory.filter((row: { outlet_id: string }) => allowed.has(row.outlet_id)) } : {}),
    })) });
  }
  return scoped;
}

export function scopeVariantInventory<T extends { inventory?: Array<{ outlet_id: string }> | null }>(variant: T, outletIds: string[]): T {
  const allowed = new Set(outletIds);
  return {
    ...variant,
    ...(Array.isArray(variant.inventory) ? { inventory: variant.inventory.filter((row) => allowed.has(row.outlet_id)) } : {}),
  };
}

export function getOutletStock(variants: Array<{ is_active?: boolean | null; inventory?: Array<{ outlet_id: string; quantity?: number | string | null; reserved?: number | string | null; low_stock_threshold?: number | string | null }> | null }>, outletIds: string[]) {
  const allowed = new Set(outletIds);
  const rows = variants.filter((variant) => variant.is_active !== false).flatMap((variant) => variant.inventory ?? []).filter((row) => allowed.has(row.outlet_id));
  return {
    availableStock: rows.reduce((total, row) => total + Math.max(0, Number(row.quantity ?? 0) - Number(row.reserved ?? 0)), 0),
    lowStockThreshold: rows.reduce((threshold, row) => Math.max(threshold, Number(row.low_stock_threshold ?? 5)), 0),
  };
}

export function isInventoryConfiguredForOutlets(
  variants: Array<{ is_active?: boolean | null; inventory?: Array<{ outlet_id: string; quantity?: number | string | null; reserved?: number | string | null }> | null }>,
  outletIds: string[],
) {
  const activeVariants = variants.filter((variant) => variant.is_active !== false);
  if (!activeVariants.length || !outletIds.length) return false;
  return activeVariants.every((variant) =>
    outletIds.every((outletId) => (variant.inventory ?? []).some((row) => row.outlet_id === outletId)),
  );
}
