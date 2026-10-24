import { requireStaffPermission } from '@/lib/staff-permissions/server';
import { apiFail, apiOk } from '@/lib/validation/schemas';
import { createServiceClient } from '@/lib/supabase/service';
import { readReviewQueue, reviewQueueQuery } from '@/lib/admin/review-queue';

export async function GET(request: Request) {
  const { user, response } = await requireStaffPermission('admin.event_promotion.review');
  if (response) return response;
  if (!user) return apiFail('UNAUTHORIZED', 'Sign in required', 401);
  const filters = reviewQueueQuery(request, 'promotions');
  if (!filters.success) return apiFail('VALIDATION_FAILED', 'Invalid queue filters', 422);
  const { data, error } = await readReviewQueue(createServiceClient(), 'promotions', filters.data);
  if (error) return apiFail('DB_ERROR', 'Unable to load review queue', 500);
  return apiOk({ ...data, promotions: data?.items ?? [] });
}
