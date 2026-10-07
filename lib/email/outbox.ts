import { sendOrderReceiptEmail } from '@/lib/email/order-receipt';
import { resolvePaymentAppUrl } from '@/lib/payments/app-url';
import { createServiceClient } from '@/lib/supabase/service';
import {
  sendAccountEmail,
  sendRecommendationEmail,
  sendTransactionEmail,
  sendVendorEmail,
} from '@/lib/email/sender';
import type {
  AccountEmailInput,
  AccountEmailType,
  RecommendationEmailInput,
  RecommendationEmailType,
  TransactionEmailInput,
  TransactionEmailType,
  VendorEmailInput,
  VendorEmailType,
  EventVendorChange,
} from '@/lib/email/templates';

export type EmailEventType =
  | TransactionEmailType
  | AccountEmailType
  | VendorEmailType
  | RecommendationEmailType;

export type EmailOutboxInput = (
  | TransactionEmailInput
  | AccountEmailInput
  | VendorEmailInput
  | RecommendationEmailInput
) & {
  eventKey: string;
  userId?: string | null;
  toEmail: string;
};

type OutboxRow = {
  id: string;
  to_email: string;
  event_type: EmailEventType;
  payload: {
    recipientName?: string | null;
    amountRm?: number;
    vendorName?: string;
    reference?: string;
    guestAccessToken?: string;
    reason?: string;
    occurredAt?: string;
    eventChange?: EventVendorChange;
  };
  status: 'pending' | 'sending' | 'sent' | 'failed';
  attempts: number;
};

export function makeEmailEventKey(eventType: EmailEventType, reference: string): string {
  return `${eventType}:${reference}`;
}

export async function enqueueEmail(input: EmailOutboxInput): Promise<{ inserted: boolean; id?: string }> {
  const db = createServiceClient();
  const payload: OutboxRow['payload'] = {
    recipientName: input.recipientName ?? null,
    occurredAt: input.occurredAt,
  };
  if ('amountRm' in input) payload.amountRm = input.amountRm;
  if ('vendorName' in input) payload.vendorName = input.vendorName;
  if ('reference' in input) payload.reference = input.reference ?? undefined;
  if ('reason' in input) payload.reason = input.reason;
  if ('eventChange' in input) payload.eventChange = input.eventChange;

  const { data, error } = await db
    .from('email_outbox')
    .upsert({
      event_key: input.eventKey,
      user_id: input.userId ?? null,
      to_email: input.toEmail,
      event_type: input.eventType,
      payload,
      status: 'pending',
      next_attempt_at: new Date().toISOString(),
    }, { onConflict: 'event_key', ignoreDuplicates: true })
    .select('id')
    .maybeSingle();

  if (error) throw error;
  return { inserted: Boolean(data), id: data?.id as string | undefined };
}

export async function processEmailOutbox(limit = 20): Promise<{ sent: number; failed: number }> {
  const db = createServiceClient();
  const { data: claimed, error: claimError } = await db.rpc('claim_email_outbox', { p_limit: limit });
  if (claimError) throw claimError;

  let sent = 0;
  let failed = 0;
  for (const row of (claimed ?? []) as OutboxRow[]) {
    try {
      if (row.payload?.guestAccessToken && !row.payload.reason) {
        const {data:order,error}=await db.from('orders').select('id,contact_email,contact_name,created_at,payment_method,subtotal,discount_amount,total_amount,order_items(product_name,variant_name,unit_price,quantity)').eq('id',row.payload.reference).is('user_id',null).single();
        if (error || !order || order.contact_email !== row.to_email) throw new Error('Guest receipt unavailable');
        await sendOrderReceiptEmail({
          recipientEmail:row.to_email,recipientName:order.contact_name ?? 'Guest',orderId:order.id,createdAt:order.created_at,paymentMethod:order.payment_method ?? 'free_reservation',
          items:(order.order_items ?? []).map(item=>({activityName:item.product_name,variantLabel:item.variant_name ?? 'Standard',unitPrice:Number(item.unit_price),qty:item.quantity})),
          subtotal:Number(order.subtotal),discount:Number(order.discount_amount),total:Number(order.total_amount),
          accessUrl:`${resolvePaymentAppUrl()}/customer/orders/access#token=${row.payload.guestAccessToken}`,
        });
      } else if (row.event_type === 'recommendation_approved') {
        await sendRecommendationEmail({
          eventType: row.event_type,
          recipientName: row.payload?.recipientName ?? null,
          vendorName: String(row.payload?.vendorName ?? 'Your recommendation'),
          occurredAt: String(row.payload?.occurredAt ?? new Date().toISOString()),
          to: row.to_email,
        });
      } else if (row.event_type.startsWith('vendor_')) {
        await sendVendorEmail({
          eventType: row.event_type as VendorEmailType,
          recipientName: row.payload?.recipientName ?? null,
          vendorName: String(row.payload?.vendorName ?? 'Your vendor'),
          reason: String(row.payload?.reason ?? 'Vendor notification update'),
          reference: row.payload?.reference ?? null,
          occurredAt: String(row.payload?.occurredAt ?? new Date().toISOString()),
          eventChange: row.payload?.eventChange,
          actionUrl: row.event_type === 'vendor_event_update' ? `${resolvePaymentAppUrl()}/vendor/events` : undefined,
          to: row.to_email,
        });
      } else if (row.event_type.startsWith('account_')) {
        await sendAccountEmail({
          eventType: row.event_type as AccountEmailType,
          recipientName: row.payload?.recipientName ?? null,
          reason: String(row.payload?.reason ?? 'Account status updated'),
          occurredAt: String(row.payload?.occurredAt ?? new Date().toISOString()),
          to: row.to_email,
        });
      } else {
        await sendTransactionEmail({
          eventType: row.event_type as TransactionEmailType,
          recipientName: row.payload?.recipientName ?? null,
          amountRm: Number(row.payload?.amountRm ?? 0),
          reference: String(row.payload?.reference ?? row.id),
          occurredAt: String(row.payload?.occurredAt ?? new Date().toISOString()),
          reason: row.payload?.reason,
          accessUrl: row.payload?.guestAccessToken ? `${resolvePaymentAppUrl()}/customer/orders/access#token=${row.payload.guestAccessToken}` : undefined,
          to: row.to_email,
        });
      }
      await db.from('email_outbox').update({
        status: 'sent',
        ...(row.payload?.guestAccessToken ? { payload: { ...row.payload, guestAccessToken: undefined } } : {}),
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_error: null,
      }).eq('id', row.id);
      sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Email send failed';
      await db.from('email_outbox').update({
        status: 'failed',
        last_error: message.slice(0, 500),
        next_attempt_at: new Date(Date.now() + 60_000).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', row.id);
      failed += 1;
    }
  }

  return { sent, failed };
}
