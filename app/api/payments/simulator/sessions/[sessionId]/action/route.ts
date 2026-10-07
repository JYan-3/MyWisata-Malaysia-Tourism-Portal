import { privateCheckoutJson } from '@/lib/checkout/guest-session';
import { authorizeCheckoutSession } from '@/lib/checkout/order-access';
import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { isSimulatorCheckoutProvider } from '@/lib/payments/providers';
import { isPaymentSimulatorEnabled } from '@/lib/payments/simulator-config';
import { settleSimulatorEvent } from '@/lib/payments/settle-simulator-event';
import { signSimulatorWebhookPayload } from '@/lib/payments/simulator-webhook';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

const actionSchema = z.object({
  outcome: z.enum(['succeeded', 'failed', 'cancelled', 'expired']),
}).strict();

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  if (!isPaymentSimulatorEnabled()) {
    return privateCheckoutJson({ error: 'Not found' }, { status: 404 });
  }

  const { sessionId } = await params;
  if (!z.uuid().safeParse(sessionId).success) {
    return privateCheckoutJson({ error: 'Invalid simulator session' }, { status: 400 });
  }
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return privateCheckoutJson({
      data: null,
      error: { code: 'VALIDATION_FAILED', message: 'A valid simulator outcome is required.' },
    }, { status: 422 });
  }

  const access = await authorizeCheckoutSession(request,sessionId);
  if (!access) return privateCheckoutJson({ error: 'Simulator session not found' }, { status: 404 });
  const session = access.session;

  const service = createServiceClient();
  const { data: payment, error: paymentError } = await service
    .from('payments')
    .select('method,provider,provider_payment_id,amount,status')
    .eq('order_id', session.order_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (paymentError) return privateCheckoutJson({ error: 'Unable to load simulator payment' }, { status: 503 });
  if (!payment || !isSimulatorCheckoutProvider(payment.provider) || !payment.provider_payment_id) {
    return privateCheckoutJson({ error: 'Simulator payment not found' }, { status: 404 });
  }

  const secret = process.env.PAYMENT_SIMULATOR_WEBHOOK_SECRET ?? '';
  const expired = Date.parse(session.expires_at) <= Date.now();
  const outcome = expired ? 'expired' : parsed.data.outcome;
  const digest = createHmac('sha256', secret)
    .update(`${session.id}:${payment.provider}:${outcome}`)
    .digest('hex')
    .slice(0, 40);
  const payload = {
    kind: 'payment' as const,
    eventId: `sim_evt_${digest}`,
    provider: payment.provider,
    providerPaymentId: payment.provider_payment_id,
    checkoutSessionId: session.id,
    eventType: `payment.${outcome}` as const,
    amountSen: Math.round(Number(payment.amount) * 100),
    currency: session.currency,
    ...(outcome === 'failed' ? {
      failure: {
        code: 'simulator_declined',
        message: 'The simulated provider declined this payment.',
        retryable: false,
      },
    } : {}),
  };
  const rawBody = JSON.stringify(payload);
  const signature = signSimulatorWebhookPayload(rawBody, secret);

  try {
    const result = await settleSimulatorEvent(rawBody, signature);
    return privateCheckoutJson({ data: result, error: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'simulator_action_failed';
    if (message.includes('conflict')) {
      return privateCheckoutJson({ error: 'Payment state conflicts with this simulator action' }, { status: 409 });
    }
    console.error('[payment-simulator] owned action failed', message);
    return privateCheckoutJson({ error: 'Unable to complete simulated provider action' }, { status: 502 });
  }
}
