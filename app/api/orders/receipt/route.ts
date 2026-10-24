import { z } from 'zod';
import { authorizeOrder } from '@/lib/checkout/order-access';
import { reserveGuestRateLimit } from '@/lib/checkout/guest-session';
import { createServiceClient } from '@/lib/supabase/service';
import { apiFail, apiOk, parseBody } from '@/lib/validation/schemas';
import { scheduleReceiptDelivery } from '@/lib/email/events';

const receiptSchema = z.object({ orderId: z.string().uuid() }).strict();

export async function POST(request: Request) {
  const parsed = await parseBody(request, receiptSchema);
  if (!parsed.ok) return parsed.response;
  const { orderId } = parsed.data;
  const access = await authorizeOrder(request, orderId);
  if (!access) return apiFail('ORDER_NOT_FOUND', 'Order not found', 404);
  if (!['paid', 'completed'].includes(access.order.status)) return apiFail('RECEIPT_UNAVAILABLE', 'Receipt is available after payment', 409);
  if (!await reserveGuestRateLimit(`receipt:${orderId}`, 3, 3600)) {
    return apiFail('RATE_LIMITED', 'Please wait before requesting another receipt', 429);
  }
  const { data, error } = await createServiceClient().rpc('queue_order_receipt', { p_order_id: orderId, p_request_hour: Math.floor(Date.now() / 3_600_000) });
  if (error || data !== true) return apiFail('RECEIPT_QUEUE_UNAVAILABLE', 'Unable to queue receipt email', 503);
  scheduleReceiptDelivery();
  return apiOk({ queued: true }, { status: 202 });
}
