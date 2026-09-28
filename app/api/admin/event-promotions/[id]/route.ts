import { requireStaffPermission } from '@/lib/staff-permissions/server';
import { apiFail, apiOk, eventPromotionReviewSchema, parseBody } from '@/lib/validation/schemas';
import { createServiceClient } from '@/lib/supabase/service';
import { getEventPromotion, reviewEventPromotion, setEventPromotionVisibility } from '@/lib/admin/event-promotions';

interface Props { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: Props) {
  const { id } = await params;
  const { user, response } = await requireStaffPermission('admin.event_promotion.review');
  if (response) return response;
  if (!user) return apiFail('UNAUTHORIZED', 'Sign in required', 401);

  const promotion = await getEventPromotion(createServiceClient(), id);
  if (!promotion) return apiFail('NOT_FOUND', 'Event promotion not found', 404);
  return apiOk({ promotion });
}

export async function PATCH(request: Request, { params }: Props) {
  const { id } = await params;
  const { db, user, response } = await requireStaffPermission('admin.event_promotion.review');
  if (response) return response;
  if (!user) return apiFail('UNAUTHORIZED', 'Sign in required', 401);

  const parsed = await parseBody(request, eventPromotionReviewSchema);
  if (!parsed.ok) return parsed.response;

  if (parsed.data.action === 'pause' || parsed.data.action === 'resume') {
    const result = await setEventPromotionVisibility(db, id, parsed.data.action);
    if (!result.ok) {
      if (result.code === 'not_found') return apiFail('NOT_FOUND', 'Event promotion not found', 404);
      if (result.code === 'not_paid') return apiFail('INVALID_STATE', 'Only a paid promotion can be paused', 409);
      if (result.code === 'not_paused') return apiFail('INVALID_STATE', 'Only a paused promotion can be resumed', 409);
      if (result.code === 'promotion_ended') return apiFail('INVALID_STATE', 'This promotion\'s date range has already ended', 409);
      if (result.code === 'capacity_exceeded') return apiFail('CAPACITY_EXCEEDED', 'That day is already at the maximum number of concurrent promotions', 409);
      if (result.code === 'admin_required') return apiFail('FORBIDDEN', 'Admin role required', 403);
      return apiFail('DB_ERROR', 'Failed to update this promotion\'s visibility', 500);
    }
    return apiOk({ ok: true });
  }

  const result = await reviewEventPromotion(db, id, parsed.data.action, parsed.data.note);
  if (!result.ok) {
    if (result.code === 'not_found') return apiFail('NOT_FOUND', 'Event promotion not found', 404);
    if (result.code === 'not_pending') return apiFail('INVALID_STATE', 'Only a pending submission can be reviewed', 409);
    if (result.code === 'admin_required') return apiFail('FORBIDDEN', 'Admin role required', 403);
    if (result.code === 'note_required') return apiFail('VALIDATION_FAILED', 'A note is required for this action', 422);
    return apiFail('DB_ERROR', 'Failed to record the review decision', 500);
  }
  return apiOk({ ok: true });
}
