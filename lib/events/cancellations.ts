import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { apiFail, apiOk } from '@/lib/validation/schemas';
import { createServiceClient } from '@/lib/supabase/service';
import { processQueuedEventRefunds } from '@/lib/refunds/process-queued-event-refunds';

// Cancelling a location or closing a vendor's stall. The database cancels the
// affected reservations and queues their refunds (cancel_event_reservations);
// automatic refunds are then processed straight away, and the cron sweep
// retries any that were not.

export const cancellationSchema = z.object({ reason: z.string().trim().min(5).max(500) }).strict();

function failure(message: string) {
  if (message.includes('not_found')) return apiFail('NOT_FOUND', 'Not found', 404);
  if (message.includes('permission_required') || message.includes('forbidden')) return apiFail('FORBIDDEN', 'You cannot cancel this', 403);
  if (message.includes('already_cancelled') || message.includes('not_editable')) return apiFail('INVALID_STATE', 'This is already closed', 409);
  if (message.includes('cancellation_reason_required')) return apiFail('VALIDATION_FAILED', 'A reason of at least 5 characters is required', 422);
  return apiFail('DB_ERROR', 'The cancellation could not be completed', 500);
}

async function refundNow() {
  // Best effort: a failure here leaves the refunds queued for the cron sweep.
  return processQueuedEventRefunds(createServiceClient()).catch(() => null);
}

export async function cancelLocation(db: SupabaseClient, locationId: string, reason: string) {
  const { error } = await db.rpc('cancel_promotion_campaign_location', { p_location_id: locationId, p_reason: reason });
  if (error) return failure(error.message ?? '');
  const refunds = await refundNow();
  return apiOk({ ok: true, refundsProcessed: refunds?.processed ?? 0 });
}

export async function closeRegistration(db: SupabaseClient, registrationId: string, action: 'withdraw' | 'remove', reason: string) {
  const { error } = await db.rpc('close_campaign_registration', { p_registration_id: registrationId, p_action: action, p_reason: reason });
  if (error) return failure(error.message ?? '');
  const refunds = await refundNow();
  return apiOk({ ok: true, refundsProcessed: refunds?.processed ?? 0 });
}

/** After an event is archived (which cancels its reservations in SQL). */
export async function processRefundsAfterArchive() {
  await refundNow();
}
