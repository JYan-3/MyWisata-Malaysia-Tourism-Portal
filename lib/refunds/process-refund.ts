import { createHmac } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isSimulatorCheckoutProvider } from '@/lib/payments/providers';
import { isPaymentSimulatorEnabled } from '@/lib/payments/simulator-config';
import { reverseOrderVendorSettlement } from '@/lib/vendor/settlement';

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
  payments: PaymentRow | PaymentRow[] | null;
};
type PaymentRow = { method: string | null; provider: string | null; provider_payment_id: string | null };

export async function processRefund({ service, walletDb, refundId, actorId, note, providerRefundOnly = false }: {
  service: SupabaseClient;
  /** Client for process_wallet_refund: the admin's session, or the service role for automatic refunds. */
  walletDb: SupabaseClient;
  refundId: string;
  actorId: string | null;
  note?: string | null;
  /** Automatic refunds must move money through a provider; never just mark them processed. */
  providerRefundOnly?: boolean;
}): Promise<ProcessRefundResult> {
  const { data } = await service.from('refunds').select('id,order_id,payment_id,amount,status,payments(method,provider,provider_payment_id)').eq('id', refundId).maybeSingle();
  const refund = data as RefundRow | null;
  if (!refund) return { ok: false, code: 'NOT_FOUND', message: 'Refund request not found', status: 404 };
  if (refund.status !== 'pending') return { ok: false, code: 'INVALID_STATE', message: 'Refund is already processed', status: 409 };

  const payment = Array.isArray(refund.payments) ? refund.payments[0] : refund.payments;
  if (payment?.method === 'wallet') {
    const { data: walletResult, error } = await walletDb.rpc('process_wallet_refund', {
      p_refund_id: refundId,
      p_note: note ?? null,
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
    try {
      const { stripe } = await import('@/lib/stripe');
      const session = await stripe.checkout.sessions.retrieve(payment.provider_payment_id, { expand: ['payment_intent'] });
      const paymentIntent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
      if (!paymentIntent) return { ok: false, code: 'INVALID_STATE', message: 'Stripe payment intent is not available yet', status: 409 };
      await stripe.refunds.create(
        { payment_intent: paymentIntent, amount: Math.round(Number(refund.amount) * 100) },
        { idempotencyKey: `refund:${refundId}` },
      );
    } catch (error) {
      return { ok: false, code: 'REFUND_FAILED', message: error instanceof Error ? error.message : 'Stripe refund failed', status: 502 };
    }
  } else if (providerRefundOnly) {
    return { ok: false, code: 'MANUAL_REFUND_REQUIRED', message: 'This payment method has no automatic refund; an admin must refund it', status: 409 };
  }
  // Keep the customer's or cancellation reason unless the admin wrote a note.
  const { error: refundError } = await service.from('refunds').update({ status: 'processed', processed_by: actorId, processed_at: new Date().toISOString(), ...(note ? { reason: note } : {}) }).eq('id', refundId);
  if (refundError) return { ok: false, code: 'DB_ERROR', message: refundError.message, status: 500 };
  await service.from('payments').update({ status: 'refunded', updated_at: new Date().toISOString() }).eq('id', refund.payment_id);
  await service.from('orders').update({ status: 'refunded', updated_at: new Date().toISOString() }).eq('id', refund.order_id);
  // Claw back any already-cleared vendor settlement for this order. Pending
  // settlements are reversed by clear_matured_vendor_settlements() on its next
  // run (it sees the refunded order); this handles the confirmed case now.
  await reverseOrderVendorSettlement(service, refund.order_id, Math.round(Number(refund.amount) * 100));
  return { ok: true, data: { refundId, status: 'processed' } };
}
