import { authorizeOrder } from '@/lib/checkout/order-access';
import { createServiceClient } from '@/lib/supabase/service';
import { apiFail, apiOk } from '@/lib/validation/schemas';
import { z } from 'zod';
import { emitVendorNotification } from '@/lib/vendor-notifications/emit';

const schema = z.object({ reason: z.string().trim().min(5).max(500) }).strict();
interface Props { params: Promise<{ orderId: string }> }

export async function POST(request: Request, { params }: Props) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiFail('VALIDATION_FAILED', 'A refund reason is required', 422);
  const { orderId } = await params;
  const service = createServiceClient();
  const access = await authorizeOrder(request,orderId);
  const order = access?.order;

  if (!order) return apiFail('NOT_FOUND', 'Order not found', 404);
  if (order.status !== 'paid' && order.status !== 'completed') return apiFail('INVALID_STATE', 'Only paid orders can be refunded', 409);
  const { data, error } = access.guestSubjectId
    ? await service.rpc('guest_request_order_refund', {
      p_order_id: orderId,
      p_guest_subject_id: access.guestSubjectId,
      p_reason: parsed.data.reason,
    })
    : await service.rpc('request_order_refund', {
      p_order_id: orderId,
      p_user_id: access.userId,
      p_reason: parsed.data.reason,
    });
  if (error) {
    if (error.message?.includes('refund_already_active')) return apiFail('REFUND_ALREADY_REQUESTED', 'A refund is already active or completed for this order', 409);
    if (error.message?.includes('refund_payment_ambiguous')) return apiFail('INVALID_STATE', 'The successful payment could not be verified safely. Contact support before requesting a refund.', 409);
    if (error.message?.includes('refund_funding_ledger_mismatch')) return apiFail('INVALID_STATE', 'The original payment allocation could not be verified safely. Contact support before requesting a refund.', 409);
    return apiFail('DB_ERROR', 'Unable to create the refund request', 500);
  }

  const { data: items } = await service.from('order_items').select('vendor_id,outlet_id').eq('order_id', orderId);
  for (const item of (items ?? []) as Array<{ vendor_id: string | null; outlet_id: string | null }>) {
    if (!item.vendor_id) continue;
    void emitVendorNotification({
      eventKey: `order:refund-requested:${orderId}:${data.id}`,
      vendorId: item.vendor_id,
      outletId: item.outlet_id,
      audience: 'owner_and_assigned_outlet',
      category: 'vendor_orders',
      type: 'vendor_order_refund_requested',
      title: 'Refund requested',
      body: `A customer requested a refund for order ${orderId}.`,
      link: `/vendor/orders?orderId=${encodeURIComponent(orderId)}`,
      email: true,
      reference: orderId,
      metadata: { reason: parsed.data.reason },
      serviceDb: service,
    }).catch((notificationError) => console.error('[vendor-notifications] refund event failed', notificationError));
  }
  return apiOk(data, { status: 201 });
}
