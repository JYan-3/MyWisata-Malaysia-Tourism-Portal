// A vendor's platform fee tier: GET shows placement, PATCH pins/unpins a tier
// (overrides the nightly 90-day sales placement). admin.vendor.manage.

import { createServiceClient } from '@/lib/supabase/service';
import { requireStaffPermission } from '@/lib/staff-permissions/server';
import { apiFail, apiOk, databaseUuidSchema, parseBody } from '@/lib/validation/schemas';
import { feeTierPinSchema, loadFeeTiers } from '@/lib/vendor/fee-tiers';

interface Props { params: Promise<{ id: string }> }

const VENDOR_FEE_COLUMNS = 'id,fee_tier_rank,fee_tier_pinned,fee_tier_sales_sen,fee_tier_evaluated_at';
type VendorFeeRow = { id: string; fee_tier_rank: number; fee_tier_pinned: number | null; fee_tier_sales_sen: number | string; fee_tier_evaluated_at: string | null };

function mapVendor(row: VendorFeeRow) {
  return {
    rank: row.fee_tier_rank,
    pinnedRank: row.fee_tier_pinned,
    salesSen: Number(row.fee_tier_sales_sen),
    evaluatedAt: row.fee_tier_evaluated_at,
  };
}

export async function GET(_request: Request, { params }: Props) {
  const { id } = await params;
  const { response } = await requireStaffPermission('admin.vendor.manage');
  if (response) return response;
  if (!databaseUuidSchema.safeParse(id).success) return apiFail('INVALID_ID', 'Vendor id is invalid', 422);

  const service = createServiceClient();
  const [{ data: vendor }, tiers] = await Promise.all([
    service.from('vendors').select(VENDOR_FEE_COLUMNS).eq('id', id).maybeSingle(),
    loadFeeTiers(service).catch(() => null),
  ]);
  if (!vendor) return apiFail('NOT_FOUND', 'Vendor not found', 404);
  if (!tiers) return apiFail('FEE_SETTINGS_LOAD_FAILED', 'Unable to load platform fee tiers', 500);
  return apiOk({ ...mapVendor(vendor as VendorFeeRow), tiers });
}

export async function PATCH(request: Request, { params }: Props) {
  const { id } = await params;
  const { user, response } = await requireStaffPermission('admin.vendor.manage');
  if (response) return response;
  if (!user) return apiFail('UNAUTHORIZED', 'Sign in required', 401);
  if (!databaseUuidSchema.safeParse(id).success) return apiFail('INVALID_ID', 'Vendor id is invalid', 422);

  const parsed = await parseBody(request, feeTierPinSchema);
  if (!parsed.ok) return parsed.response;

  const service = createServiceClient();
  const { data: before } = await service.from('vendors').select(VENDOR_FEE_COLUMNS).eq('id', id).maybeSingle();
  if (!before) return apiFail('NOT_FOUND', 'Vendor not found', 404);
  const { data, error } = await service.from('vendors').update({ fee_tier_pinned: parsed.data.pinnedRank }).eq('id', id).select(VENDOR_FEE_COLUMNS).single();
  if (error || !data) return apiFail('DB_ERROR', 'Unable to change the vendor fee tier', 500);

  await service.from('audit_logs').insert({
    actor_id: user.id, action: 'vendor.fee_tier_pinned', entity_type: 'vendor', entity_id: id,
    before_data: { pinnedRank: (before as VendorFeeRow).fee_tier_pinned }, after_data: { pinnedRank: parsed.data.pinnedRank },
  });
  return apiOk(mapVendor(data as VendorFeeRow));
}
