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

/** Runs the paid-order side effects once. Returns false when a step failed, leaving the order for the next run. */
export async function runPaidOrderEffects(service: SupabaseClient, orderId: string): Promise<boolean> {
  // Only a paid order can be marked done; an unpaid one is picked up by the job once it is paid.
  const { data: order, error: orderError } = await service.from('orders').select('status').eq('id', orderId).maybeSingle();
  if (orderError || !order || !['paid', 'completed'].includes(String(order.status).toLowerCase())) return false;

  try {
    if (!(await onOrderPaid(orderId))) return false;
    const reward = await attributeRecommendationReward(service, orderId);
    if (reward.kind === 'created') {
      const deliveries = reward.rewards.flatMap(({ commissionId, recommenderId, amountSen }) => {
        const amountRm = amountSen / 100;
        return [
          service.from('notifications').upsert({ user_id: recommenderId, type: 'recommendation_reward_pending', title: 'Your recommendation earned a pending reward', body: `${formatMYR(amountRm)} will be available after the 7-day hold and KYC approval.`, link: '/customer/wallet', category: 'wallet', event_key: `reward_pending:in_app:${commissionId}`, metadata: { commission_id: commissionId } }, { onConflict: 'event_key', ignoreDuplicates: true }),
          enqueueUserTransactionEmail({ userId: recommenderId, eventType: 'recommendation_reward_pending', eventKey: `reward_pending:email:${commissionId}`, reference: 'Recommendation reward', amountRm, deferDelivery: true }),
        ];
      });
      for (const result of await Promise.allSettled(deliveries)) {
        if (result.status === 'rejected' || (result.value && 'error' in result.value && result.value.error)) {
          console.error('[paid-order-effects] reward notification intent unavailable');
          return false;
        }
      }
    }
  } catch (_error) {
    console.error('[paid-order-effects] paid order side effect unavailable');
    return false;
  }

  // Payouts are funded from the platform fee; make the fee cover what was just created.
  try {
    if (!(await applyOrderPlatformFeeFloor(service, orderId))) return false;
  } catch (_error) {
    console.error('[paid-order-effects] platform fee floor unavailable');
    return false;
  }

  const { error } = await service.from('orders').update({ paid_effects_processed_at: new Date().toISOString() }).eq('id', orderId);
  if (error) {
    console.error('[paid-order-effects] could not mark order processed');
    return false;
  }
  return true;
}

/** The background job: paid orders from the last 30 days that have not been processed yet, oldest first. */
export async function processPaidOrders(service: SupabaseClient, limit = 50) {
  const boundedLimit = Math.max(1, Math.min(50, Math.floor(Number.isFinite(limit) ? limit : 50)));
  const { data, error } = await service.rpc('claim_paid_order_effects', { p_limit: boundedLimit });
  if (error || !Array.isArray(data)) throw new Error('paid_order_effects_claim_unavailable');

  const result = { processed: 0, failed: 0 };
  for (const { order_id: orderId, lease_token: leaseToken } of data as Array<{ order_id: string; lease_token: string }>) {
    const succeeded = await runPaidOrderEffects(service, orderId);
    const { data: finished, error: finishError } = await service.rpc('finish_paid_order_effects', {
      p_order_id: orderId,
      p_lease_token: leaseToken,
      p_succeeded: succeeded,
      p_safe_error: succeeded ? null : 'paid_order_effects_retryable_failure',
    });
    if (finishError || finished !== true) {
      result.failed += 1;
      console.error('[paid-order-effects] progress acknowledgement unavailable');
    } else if (succeeded) result.processed += 1;
    else result.failed += 1;
  }
  return result;
}
