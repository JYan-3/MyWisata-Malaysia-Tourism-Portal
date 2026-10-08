import { requireStaffPermission } from '@/lib/staff-permissions/server';
import { apiFail, apiOk, databaseUuidSchema, parseBody } from '@/lib/validation/schemas';
import { campaignLocationMutationSchema } from '@/lib/promotion-campaigns/validation';
import { locationFailure, protectedLocationParameters } from '@/lib/admin/campaign-locations';

export async function POST(request: Request, context: { params: Promise<{ id: string; locationId: string }> }) {
  const auth = await requireStaffPermission('admin.promotion_campaign.manage');
  if (auth.response) return auth.response;
  const { id, locationId } = await context.params;
  if (!databaseUuidSchema.safeParse(id).success || !databaseUuidSchema.safeParse(locationId).success) return apiFail('INVALID_ID', 'Location id is invalid', 422);
  const parsed = await parseBody(request, campaignLocationMutationSchema);
  if (!parsed.ok) return parsed.response;
  const parameters = protectedLocationParameters(id, locationId, parsed.data);
  const { p_reason: _reason, ...previewParameters } = parameters;
  void _reason;
  const { data, error } = await auth.db.rpc('preview_promotion_campaign_location_change', previewParameters);
  if (error) return locationFailure(error);
  // Explicitly project counts; never return customer/order/vendor identifiers.
  return apiOk({ locationUpdatedAt: data.locationUpdatedAt, affectedReservations: data.affectedReservations,
    affectedVendors: data.affectedVendors, incompatibleSlots: data.incompatibleSlots, blockingReasons: data.blockingReasons, ...(typeof data.requiresReason === 'boolean' ? { requiresReason: data.requiresReason } : {}) });
}
