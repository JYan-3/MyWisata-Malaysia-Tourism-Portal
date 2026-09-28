import { NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { headers } from 'next/headers';
import { createServiceClient } from '@/lib/supabase/service';
import { stripe } from '@/lib/stripe';
import type Stripe from 'stripe';
import { enqueueUserTransactionEmail } from '@/lib/email/events';
import { getPaymentEmailType } from '@/lib/email/payment';
import { emitOrderVendorEvent } from '@/lib/vendor-notifications/order-events';
import { log } from '@/lib/log';
import { getRequestId } from '@/lib/request-id';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const requestId = getRequestId(req);
  const body = await req.text();
  const headersList = await headers();
  const sig = headersList.get('stripe-signature');
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !secret) {
    return NextResponse.json({ error: 'Missing stripe-signature or webhook secret' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret);
  } catch (err) {
    return NextResponse.json(
      { error: `Webhook signature failed: ${(err as Error).message}` },
      { status: 400 },
    );
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.metadata?.user_id;

    if (!userId || !session.amount_total) {
      log('error', '[stripe-webhook] Missing user_id metadata or amount_total', { requestId, sessionId: session.id });
      return NextResponse.json({ error: 'Missing metadata', requestId }, { status: 400 });
    }

    const db = createServiceClient();

    if (session.metadata?.payment_kind === 'order' && session.metadata.checkout_session_id) {
      if (session.payment_status !== 'paid' || !session.currency) {
        return NextResponse.json({ error: 'Order payment is not confirmed as paid' }, { status: 409 });
      }
      const { data: finalizeData, error: finalizeError } = await db.rpc('settle_provider_checkout', {
        p_checkout_session_id: session.metadata.checkout_session_id,
        p_provider: 'stripe',
        p_outcome: 'succeeded',
        p_provider_payment_id: session.id,
        p_provider_event_id: event.id,
        p_payload_sha256: createHash('sha256').update(body).digest('hex'),
        p_amount_sen: session.amount_total,
        p_currency: session.currency.toUpperCase(),
      });
      if (finalizeError) {
        log('error', '[stripe-webhook] order finalize RPC failed', { requestId, error: finalizeError.message });
        return NextResponse.json({ error: 'Failed to finalize order', requestId }, { status: 500 });
      }
      const idempotent = Boolean(finalizeData && typeof finalizeData === 'object' && 'idempotent' in finalizeData && finalizeData.idempotent);
      const orderId = finalizeData && typeof finalizeData === 'object' && 'order_id' in finalizeData && typeof finalizeData.order_id === 'string' ? finalizeData.order_id : session.metadata.order_id ?? null;
      if (!idempotent) {
        const paymentEmail = getPaymentEmailType('order');
        try {
          await enqueueUserTransactionEmail({
            userId,
            eventType: paymentEmail.eventType,
            eventKey: `${paymentEmail.keyPrefix}:${session.id}`,
            reference: session.id,
            amountRm: session.amount_total / 100,
            occurredAt: new Date(event.created * 1000).toISOString(),
          });
        } catch (emailError) {
          log('error', '[stripe-webhook] payment email enqueue failed', { requestId, error: emailError instanceof Error ? emailError.message : String(emailError) });
        }
      }
      if (!idempotent && orderId) {
        void emitOrderVendorEvent({
          serviceDb: db,
          orderId,
          eventKey: `order:paid:${orderId}`,
          type: 'vendor_order_created',
          title: 'New order received',
          body: `Order ${orderId} has been paid and is ready for fulfilment.`,
          email: true,
        }).catch((notificationError) => log('error', '[vendor-notifications] webhook order event failed', { requestId, error: notificationError instanceof Error ? notificationError.message : String(notificationError) }));
      }
      return NextResponse.json({ received: true });
    }

    if (session.metadata?.payment_kind === 'event_promotion' && session.metadata.promotion_id) {
      if (session.payment_status !== 'paid' || !session.amount_total) {
        return NextResponse.json({ error: 'Event promotion payment is not confirmed as paid' }, { status: 409 });
      }
      const { error: confirmError } = await db.rpc('confirm_vendor_event_promotion_stripe_payment', {
        p_promotion_id: session.metadata.promotion_id,
        p_checkout_session_id: session.id,
        p_amount_sen: session.amount_total,
      });
      if (confirmError) {
        log('error', '[stripe-webhook] event promotion payment confirm RPC failed', { requestId, error: confirmError.message });
        return NextResponse.json({ error: 'Failed to confirm event promotion payment', requestId }, { status: 500 });
      }
      return NextResponse.json({ received: true });
    }

    const { error } = await db.rpc('credit_topup', {
      p_user_id:         userId,
      p_amount_sen:      session.amount_total,  // Stripe MYR amount_total is already in sen
      p_stripe_event_id: event.id,
      p_stripe_ref:      typeof session.payment_intent === 'string'
                           ? session.payment_intent
                           : null,
    });

    if (error) {
      log('error', '[stripe-webhook] credit_topup RPC failed', { requestId, error: error.message });
      return NextResponse.json({ error: 'Failed to credit wallet', requestId }, { status: 500 });
    }

    const paymentEmail = getPaymentEmailType(session.metadata?.payment_kind);
    try {
      await enqueueUserTransactionEmail({
        userId,
        eventType: paymentEmail.eventType,
        eventKey: `${paymentEmail.keyPrefix}:${session.id}`,
        reference: session.id,
        amountRm: session.amount_total / 100,
        occurredAt: new Date(event.created * 1000).toISOString(),
      });
    } catch (emailError) {
      log('error', '[stripe-webhook] payment email enqueue failed', { requestId, error: emailError instanceof Error ? emailError.message : String(emailError) });
    }
  }

  if (event.type === 'payment_intent.payment_failed') {
    const intent = event.data.object as Stripe.PaymentIntent;
    const userId = intent.metadata?.user_id;
    if (userId && intent.metadata?.payment_kind === 'topup') {
      try {
        await enqueueUserTransactionEmail({
          userId,
          eventType: 'topup_failed',
          eventKey: `stripe-topup-failed:${event.id}`,
          reference: 'Wallet top-up',
          amountRm: (intent.amount ?? 0) / 100,
          occurredAt: new Date(event.created * 1000).toISOString(),
        });
      } catch (emailError) {
        log('error', '[stripe-webhook] top-up failure email enqueue failed', { requestId, error: emailError instanceof Error ? emailError.message : String(emailError) });
      }
    }
  }

  if (event.type === 'checkout.session.expired') {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.metadata?.user_id;
    if (userId && session.metadata?.payment_kind === 'topup') {
      try {
        await enqueueUserTransactionEmail({
          userId,
          eventType: 'topup_failed',
          eventKey: `stripe-topup-expired:${event.id}`,
          reference: 'Wallet top-up',
          amountRm: (session.amount_total ?? 0) / 100,
          occurredAt: new Date(event.created * 1000).toISOString(),
        });
      } catch (emailError) {
        log('error', '[stripe-webhook] expired top-up email enqueue failed', { requestId, error: emailError instanceof Error ? emailError.message : String(emailError) });
      }
    }
  }

  if (event.type === 'charge.dispute.created') {
    const dispute = event.data.object as Stripe.Dispute;
    const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id;
    if (chargeId) {
      const db = createServiceClient();
      const { data: payment } = await db.from('payments').select('order_id').eq('provider_payment_id', chargeId).maybeSingle();
      if (payment?.order_id) {
        const { error } = await db.rpc('mark_order_financial_outcome', { p_order_id: payment.order_id, p_status: 'chargeback', p_actor_id: null, p_provider_event_id: event.id });
        if (error) log('error', '[stripe-webhook] dispute outcome failed', { requestId, error: error.message });
      }
    }
  }

  // All other event types → acknowledge immediately (no-op)
  return NextResponse.json({ received: true });
}
