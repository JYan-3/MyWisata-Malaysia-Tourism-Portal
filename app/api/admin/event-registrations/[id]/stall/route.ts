import { requireStaffPermission } from '@/lib/staff-permissions/server';
import { apiFail, apiOk, databaseUuidSchema, parseBody } from '@/lib/validation/schemas';
import { campaignStallChangeSchema } from '@/lib/promotion-campaigns/validation';
import { locationFailure } from '@/lib/admin/campaign-locations';
import { processEmailOutbox } from '@/lib/email/outbox';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireStaffPermission('admin.promotion_campaign.manage');
  if (auth.response) return auth.response;
  const { id } = await context.params;
  if (!databaseUuidSchema.safeParse(id).success) return apiFail('INVALID_ID', 'Registration id is invalid', 422);
  const parsed = await parseBody(request, campaignStallChangeSchema);
  if (!parsed.ok) return parsed.response;
  const { data, error } = await auth.db.rpc('change_campaign_vendor_stall', {
    p_registration_id: id, p_expected_updated_at: parsed.data.expectedUpdatedAt,
    p_stall_number: parsed.data.stallNumber, p_reason: parsed.data.reason ?? null,
  });
  if (error) return locationFailure(error);
  if (data?.notificationQueued) {
    try { await processEmailOutbox(20); } catch { console.error('[event-notice] Delivery deferred to the outbox processor'); }
  }
  return apiOk(data);
}
