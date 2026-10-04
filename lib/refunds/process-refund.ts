import { createHmac } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isSimulatorCheckoutProvider } from '@/lib/payments/providers';
import { isPaymentSimulatorEnabled } from '@/lib/payments/simulator-config';

// Approving a refund: return the money through the original payment method,
// then mark the refund, payment and order as refunded. Shared by the admin
// refund queue and the automatic processing of cancelled event reservations.

export type ProcessRefundResult =
  | { ok: true; data: unknown }
  | { ok: false; code: string; message: string; status: number };

type RefundRow = {
  id: string;
  order_id: string;
  payment_id: string;
  amount: number;
  status: string;
  wallet_topup_sen?: number | null;
  wallet_earnings_sen?: number | null;
  external_amount_sen?: number | null;
  payments: PaymentRow | PaymentRow[] | null;
};
type PaymentRow = { method: string | null; provider: string | null; provider_payment_id: string | null };

export async function processRefund({ service, walletDb, refundId, actorId, note, manualReference, providerRefundOnly = false }: {
  service: SupabaseClient;
  /** Kept for caller compatibility; refund finalization is service-only and always uses `service`. */
  walletDb: SupabaseClient;
  refundId: string;
  actorId: string | null;
  note?: string | null;
  manualReference?: string | null;
  /** Automatic refunds must move money through a provider; never just mark them processed. */
  providerRefundOnly?: boolean;
}): Promise<ProcessRefundResult> {
  void walletDb;
  const { data } = await service.from('refunds').select('id,order_id,payment_id,amount,status,wallet_topup_sen,wallet_earnings_sen,external_amount_sen,payments(method,provider,provider_payment_id)').eq('id', refundId).maybeSingle();
  const refund = data as RefundRow | null;
  if (!refund) return { ok: false, code: 'NOT_FOUND', message: 'Refund request not found', status: 404 };
  if (refund.status !== 'pending') return { ok: false, code: 'INVALID_STATE', message: 'Refund is already processed', status: 409 };

  const payment = Array.isArray(refund.payments) ? refund.payments[0] : refund.payments;
  if (payment?.method === 'wallet') {
    const { data: walletResult, error } = await service.rpc('process_wallet_refund', {
      p_refund_id: refundId,
      p_note: note ?? null,
      p_actor_id: actorId,
    });
    if (error) {
      const message = error.message ?? 'Unable to process Wallet refund';
      return message.includes('super_admin_required')
        ? { ok: false, code: 'FORBIDDEN', message, status: 403 }
        : { ok: false, code: 'REFUND_FAILED', message, status: 409 };
    }
    return { ok: true, data: walletResult };
  }
  if (payment?.provider && isSimulatorCheckoutProvider(payment.provider)) {
    if (!isPaymentSimulatorEnabled()) {
      return { ok: false, code: 'PAYMENT_SIMULATOR_UNAVAILABLE', message: 'Simulated provider refunds are unavailable in this environment', status: 503 };
    }
    const secret = process.env.PAYMENT_SIMULATOR_WEBHOOK_SECRET ?? '';
    const providerRefundId = `sim_refund_${createHmac('sha256', secret)
      .update(`${refundId}:${payment.provider}`)
      .digest('hex')
      .slice(0, 40)}`;
    const { data: simulated, error } = await service.rpc('begin_simulated_refund', {
      p_refund_id: refundId,
      p_provider: payment.provider,
      p_provider_refund_id: providerRefundId,
    });
    if (error) return { ok: false, code: 'REFUND_FAILED', message: error.message, status: 409 };
    return { ok: true, data: simulated };
  }
  if (payment?.provider === 'stripe') {
    if (!payment.provider_payment_id) return { ok: false, code: 'INVALID_STATE', message: 'Stripe payment reference is missing', status: 409 };
    const externalAmountSen = Math.max(0, Math.round(Number(refund.external_amount_sen ?? Number(refund.amount) * 100)));
    if (externalAmountSen === 0) {
      const { data: walletResult, error } = await service.rpc('process_wallet_refund', {
        p_refund_id: refundId,
        p_note: note ?? null,
        p_actor_id: actorId,
      });
      if (error) return { ok: false, code: 'REFUND_FAILED', message: error.message ?? 'Unable to restore wallet-funded order', status: 409 };
      return { ok: true, data: walletResult };
    }
    try {
      const { stripe } = await import('@/lib/stripe');
      const session = await stripe.checkout.sessions.retrieve(payment.provider_payment_id, { expand: ['payment_intent'] });
      const paymentIntent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
      if (!paymentIntent) return { ok: false, code: 'INVALID_STATE', message: 'Stripe payment intent is not available yet', status: 409 };
      const providerRefund = await stripe.refunds.create(
        { payment_intent: paymentIntent, amount: externalAmountSen, metadata: { mywisata_refund_id: refundId } },
        { idempotencyKey: `refund:${refundId}` },
      );
      const providerStatus = providerRefund.status === 'succeeded'
        ? 'succeeded'
        : providerRefund.status === 'pending'
          ? 'pending'
          : 'failed';
      if (providerRefund.amount !== externalAmountSen || providerRefund.currency?.toUpperCase() !== 'MYR') {
        return { ok: false, code: 'PROVIDER_REFUND_MISMATCH', message: 'Stripe returned a different refund amount or currency', status: 502 };
      }
      const { data: outcome, error: outcomeError } = await service.rpc('record_order_refund_provider_outcome', {
        p_refund_id: refundId,
        p_provider_refund_id: providerRefund.id,
        p_outcome: providerStatus,
        p_amount_sen: externalAmountSen,
        p_currency: 'MYR',
        p_failure_code: providerRefund.failure_reason ?? null,
        p_failure_message: providerRefund.status === 'failed' ? 'Stripe could not complete this refund.' : null,
        p_actor_id: actorId,
        p_note: note ?? null,
      });
      if (outcomeError) return { ok: false, code: 'REFUND_FAILED', message: outcomeError.message ?? 'Unable to record Stripe refund outcome', status: 409 };
      return { ok: true, data: outcome };
    } catch (error) {
      return { ok: false, code: 'REFUND_FAILED', message: error instanceof Error ? error.message : 'Stripe refund failed', status: 502 };
    }
  }
  if (providerRefundOnly) {
    return { ok: false, code: 'MANUAL_REFUND_REQUIRED', message: 'This payment method has no automatic refund; an admin must refund it', status: 409 };
  }
  if (!manualReference?.trim()) {
    return { ok: false, code: 'MANUAL_REFUND_REFERENCE_REQUIRED', message: 'Enter the completed bank or provider transaction reference before recording this refund.', status: 422 };
  }
  const { data: manualResult, error: manualError } = await service.rpc('complete_manual_order_refund', {
    p_refund_id: refundId,
    p_manual_reference: manualReference.trim(),
    p_actor_id: actorId,
    p_note: note ?? null,
  });
  if (manualError) return { ok: false, code: 'REFUND_FAILED', message: manualError.message ?? 'Unable to record the manual refund', status: 409 };
  return { ok: true, data: manualResult };
}
