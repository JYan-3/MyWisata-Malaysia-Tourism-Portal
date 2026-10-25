import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
import { z } from 'zod';

const count = z.number().finite().nonnegative();
const healthSchema = z.object({
  kyc: z.object({ queued: count, processing: count, failed: count, oldestQueuedSeconds: count, completedLastHour: count, expiredLeases: count }),
  humanReview: z.object({ pending: count, completedLastHour: count, oldestPendingSeconds: count }),
  approverNotifications: z.object({ pending: count, reviewRequired: count, oldestPendingSeconds: count }),
  email: z.object({ pending: count, sending: count, failed: count, reviewRequired: count, expiredSending: count, oldestPendingSeconds: count }),
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

const nullableCount = count.nullable();
const financialQueueSchema = z.object({
  availability: z.enum(['available', 'partial', 'unavailable']),
  pending: nullableCount,
  oldestPendingSeconds: nullableCount,
  enteredLastHour: nullableCount,
  reenteredLastHour: nullableCount,
  retriesLastHour: nullableCount,
  completedLastHour: nullableCount,
  reviewRequired: nullableCount,
  sampleCount: count,
  unavailableReason: z.string().nullable(),
});

export const financialOperationsHealthSchema = z.object({
  computedAt: z.string().nullable(),
  windowStart: z.string(),
  windowEnd: z.string(),
  availability: z.enum(['available', 'partial', 'stale', 'unavailable']),
  unavailableReasons: z.array(z.string()),
  queues: z.object({
    paidEffects: financialQueueSchema,
    affiliateClearing: financialQueueSchema,
    guestReview: financialQueueSchema,
    withdrawalReview: financialQueueSchema,
    payoutUnknown: financialQueueSchema,
    refundPending: financialQueueSchema,
  }),
  liabilitiesSen: z.object({ pendingEarnings: count, availableEarnings: count, reservedEarnings: count }).nullable(),
  economicsSen: z.object({
    refundClawbackShortfall: count.nullable(),
    postMaturityExposure: count.nullable(),
    stackedRewardCost: count.nullable(),
    payoutFees: count.nullable(),
    netMargin: count.nullable(),
  }).nullable(),
  fraudReviewSample: z.object({ resolved: count, released: count, rejected: count }).nullable(),
  cashAvailableSen: count.nullable(),
});

export type FinancialOperationsHealth = z.infer<typeof financialOperationsHealthSchema>;

export async function getFinancialOperationsHealth() {
  const { data, error } = await createServiceClient().rpc('financial_operations_health').abortSignal(AbortSignal.timeout(5_000));
  const parsed = financialOperationsHealthSchema.safeParse(data);
  if (error || !parsed.success) throw new Error('financial_operations_health_unavailable');
  return parsed.data;
}
