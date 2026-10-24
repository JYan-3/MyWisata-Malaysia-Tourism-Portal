import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import { z } from 'zod';

const count = z.number().finite().nonnegative();
const healthSchema = z.object({
  kyc: z.object({ queued: count, processing: count, failed: count, oldestQueuedSeconds: count, completedLastHour: count, expiredLeases: count }),
  humanReview: z.object({ pending: count, completedLastHour: count, oldestPendingSeconds: count }),
  approverNotifications: z.object({ pending: count, reviewRequired: count, oldestPendingSeconds: count }),
  email: z.object({ pending: count, oldestPendingSeconds: count }),
  dispatches: z.record(z.string(), z.object({ lastStartedAt: z.string().nullable(), lastSucceededAt: z.string().nullable(), lastFailedAt: z.string().nullable() })),
});

export async function recordPortalDispatch(scope: 'kyc' | 'email' | 'recommendation_images', state: 'started' | 'succeeded' | 'failed') {
  const { error } = await createServiceClient().rpc('record_portal_dispatch', { p_scope: scope, p_state: state }).abortSignal(AbortSignal.timeout(5_000));
  if (error) throw new Error('dispatch_record_unavailable');
}

export async function portalQueueHealth() {
  const { data, error } = await createServiceClient().rpc('portal_queue_health').abortSignal(AbortSignal.timeout(5_000));
  const parsed = healthSchema.safeParse(data);
  if (error || !parsed.success) throw new Error('queue_health_unavailable');
  return { ...parsed.data, prescreeningEnabled: process.env.KYC_PRESCREENING_ENABLED === 'true' };
}
