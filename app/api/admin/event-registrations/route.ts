import { requireStaffPermission } from '@/lib/staff-permissions/server';
import { apiFail, apiOk } from '@/lib/validation/schemas';
import { createServiceClient } from '@/lib/supabase/service';
import { readReviewQueue, reviewQueueQuery } from '@/lib/admin/review-queue';

export async function GET(request: Request) {
  const { user, response } = await requireStaffPermission('admin.promotion_campaign.manage');
  if (response) return response;
  if (!user) return apiFail('UNAUTHORIZED', 'Sign in required', 401);
  const filters = reviewQueueQuery(request, 'registrations');
  if (!filters.success) return apiFail('VALIDATION_FAILED', 'Invalid queue filters', 422);
  const { data, error } = await readReviewQueue(createServiceClient(), 'registrations', filters.data);
  if (error) return apiFail('DB_ERROR', 'Unable to load review queue', 500);
  return apiOk({ ...data, registrations: data?.items ?? [] });
}
