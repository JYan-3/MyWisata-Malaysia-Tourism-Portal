import type { SupabaseClient } from '@supabase/supabase-js';
import { processRefund } from '@/lib/refunds/process-refund';

/**
 * Refunds queued automatically when an event, location or stall was cancelled
 * before the event started (refunds.auto_process, set by
 * cancel_event_reservations). Runs right after a cancellation and from the
 * cron sweep. A refund that cannot be processed automatically is handed to
 * the admin queue (auto_process off, reason kept) instead of being retried.
 */
export async function processQueuedEventRefunds(service: SupabaseClient, limit = 25) {
  const { data, error } = await service
    .from('refunds')
    .select('id')
    .eq('status', 'pending')
    .eq('auto_process', true)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) return { processed: 0, awaitingProvider: 0, handedToAdmin: 0, error: error.message };

  let processed = 0;
  let handedToAdmin = 0;
  let awaitingProvider = 0;
  for (const { id } of (data ?? []) as { id: string }[]) {
    const result = await processRefund({ service, walletDb: service, refundId: id, actorId: null, providerRefundOnly: true });
    const outcome = result.ok && result.data && typeof result.data === 'object' && 'status' in result.data ? result.data.status : null;
    if (result.ok && outcome === 'processed') { processed += 1; continue; }
    if (result.ok && outcome === 'approved') { awaitingProvider += 1; continue; }
    handedToAdmin += 1;
    await service.from('refunds').update({
      auto_process: false,
      provider_failure_code: result.ok ? 'REFUND_NOT_COMPLETED' : result.code,
      provider_failure_message: result.ok ? 'Refund requires operator attention' : result.message.slice(0, 500),
      updated_at: new Date().toISOString(),
    }).eq('id', id).eq('status', 'pending');
  }
  return { processed, awaitingProvider, handedToAdmin, error: null };
}
