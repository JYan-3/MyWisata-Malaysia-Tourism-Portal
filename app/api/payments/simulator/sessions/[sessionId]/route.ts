import { privateCheckoutJson } from '@/lib/checkout/guest-session';
import { authorizeCheckoutSession } from '@/lib/checkout/order-access';
import { z } from 'zod';
import { isSimulatorCheckoutProvider } from '@/lib/payments/providers';
import { isPaymentSimulatorEnabled } from '@/lib/payments/simulator-config';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ sessionId: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  if (!isPaymentSimulatorEnabled()) {
    return privateCheckoutJson({ error: 'Not found' }, { status: 404 });
  }

  const { sessionId } = await params;
  if (!z.uuid().safeParse(sessionId).success) {
    return privateCheckoutJson({ error: 'Invalid simulator session' }, { status: 400 });
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

  return privateCheckoutJson({
    data: {
      sessionId: session.id,
      orderId: session.order_id,
      provider: payment.provider,
      providerPaymentId: payment.provider_payment_id,
      amountSen: Math.round(Number(payment.amount) * 100),
      currency: session.currency,
      status: session.status,
      expiresAt: session.expires_at,
      simulated: true,
    },
    error: null,
  });
}
