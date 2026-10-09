// Everything that should happen once an order is paid, beyond settlement:
// the affiliate commission, recommendation rewards (and their notifications),
// and the platform-fee floor that funds them. One server-side entry point, so
// it no longer depends on the buyer's browser coming back to our checkout page.
//
// Called from:
//  - /api/checkout/attribute (fast path when the browser returns: card, wallet, free)
//  - /api/cron/process-paid-orders every 5 minutes (every payment method, guests,
//    events; also the retry for anything the fast path missed or failed)
// Every step is idempotent, so overlapping runs are harmless.
// Docs/plans/2026-10-08-2216-server-side-referral-attribution.md

import type { SupabaseClient } from '@supabase/supabase-js';
import { onOrderPaid } from '@/lib/affiliate/attribution';
import { attributeRecommendationReward } from '@/lib/recommendations/reward-attribution';
import { applyOrderPlatformFeeFloor } from '@/lib/vendor/settlement';
import { enqueueUserTransactionEmail } from '@/lib/email/events';
import { formatMYR } from '@/lib/i18n/format';

/** Orders older than this are never picked up by the job (they were placed before it existed or failed for weeks). */
const LOOKBACK_DAYS = 30;

/** Runs the paid-order side effects once. Returns false when a step failed, leaving the order for the next run. */
export async function runPaidOrderEffects(service: SupabaseClient, orderId: string): Promise<boolean> {
  // Only a paid order can be marked done; an unpaid one is picked up by the job once it is paid.
  const { data: order } = await service.from('orders').select('status').eq('id', orderId).maybeSingle();
  if (!order || !['paid', 'completed'].includes(String(order.status).toLowerCase())) return false;

  if (!(await onOrderPaid(orderId))) return false;

  try {
    const reward = await attributeRecommendationReward(service, orderId);
    if (reward.kind === 'created') {
      const deliveries = reward.rewards.flatMap(({ commissionId, recommenderId, amountSen }) => {
        const amountRm = amountSen / 100;
        return [
          service.from('notifications').insert({ user_id: recommenderId, type: 'recommendation_reward_pending', title: 'Your recommendation earned a pending reward', body: `${formatMYR(amountRm)} will be available after the 7-day hold and KYC approval.`, link: '/customer/wallet' }),
          enqueueUserTransactionEmail({ userId: recommenderId, eventType: 'recommendation_reward_pending', eventKey: `recommendation_reward_pending:${commissionId}`, reference: 'Recommendation reward', amountRm }),
        ];
      });
      for (const result of await Promise.allSettled(deliveries)) {
        // A missed notification must not re-run the reward; the reward itself is saved.
        if (result.status === 'rejected') console.error('[paid-order-effects] reward notification failed', orderId, result.reason);
      }
    }
  } catch (error) {
    console.error('[paid-order-effects] recommendation reward failed', orderId, error);
    return false;
  }

  // Payouts are funded from the platform fee; make the fee cover what was just created.
  await applyOrderPlatformFeeFloor(service, orderId);

  const { error } = await service.from('orders').update({ paid_effects_processed_at: new Date().toISOString() }).eq('id', orderId);
  if (error) {
    console.error('[paid-order-effects] could not mark order processed', orderId, error.message);
    return false;
  }
  return true;
}

/** The background job: paid orders from the last 30 days that have not been processed yet, oldest first. */
export async function processPaidOrders(service: SupabaseClient, limit = 50) {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();
  const { data, error } = await service
    .from('orders')
    .select('id')
    .in('status', ['paid', 'completed'])
    .is('paid_effects_processed_at', null)
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);

  const result = { processed: 0, failed: 0 };
  for (const { id } of (data ?? []) as Array<{ id: string }>) {
    if (await runPaidOrderEffects(service, id)) result.processed += 1;
    else result.failed += 1;
  }
  return result;
}
