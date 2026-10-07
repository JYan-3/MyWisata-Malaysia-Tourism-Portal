import { requireStaffPermission } from '@/lib/staff-permissions/server';
import { apiFail, apiOk, campaignRegistrationReviewSchema, parseBody } from '@/lib/validation/schemas';
import { createServiceClient } from '@/lib/supabase/service';
import { getCampaignRegistration, reviewCampaignRegistration } from '@/lib/admin/campaign-registrations';

import { locationFailure } from '@/lib/admin/campaign-locations';
import { processEmailOutbox } from '@/lib/email/outbox';

interface Props { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: Props) {
  const { id } = await params;
  const { user, response } = await requireStaffPermission('admin.promotion_campaign.manage');
  if (response) return response;
  if (!user) return apiFail('UNAUTHORIZED', 'Sign in required', 401);

  const registration = await getCampaignRegistration(createServiceClient(), id);
  if (!registration) return apiFail('NOT_FOUND', 'Registration not found', 404);
  return apiOk({ registration });
}

export async function PATCH(request: Request, { params }: Props) {
  const { id } = await params;
  const { db, user, response } = await requireStaffPermission('admin.promotion_campaign.manage');
  if (response) return response;
  if (!user) return apiFail('UNAUTHORIZED', 'Sign in required', 401);

  const parsed = await parseBody(request, campaignRegistrationReviewSchema);
  if (!parsed.ok) return parsed.response;

  const result = await reviewCampaignRegistration(db, id, parsed.data.action, parsed.data.note, parsed.data.stallNumber, parsed.data.expectedUpdatedAt);
  if (!result.ok) {
    if (result.code === 'not_found') return apiFail('NOT_FOUND', 'Registration not found', 404);
    if (result.code === 'not_pending') return apiFail('INVALID_STATE', 'Only a pending registration can be reviewed', 409);
    if (result.code === 'admin_required') return apiFail('FORBIDDEN', 'Admin role required', 403);
    if (result.code === 'note_required') return apiFail('VALIDATION_FAILED', 'A note is required for this action', 422);
    return locationFailure({ message: result.message });
  }
  if (result.notificationQueued) {
    try { await processEmailOutbox(20); } catch { console.error('[event-notice] Delivery deferred to the outbox processor'); }
  }
  return apiOk({ ok: true, notificationQueued: result.notificationQueued });
}
