import { EmailDeliveryError, type EmailDelivery } from '@/lib/email/delivery';
import { sendOrderReceiptEmail } from '@/lib/email/order-receipt';
import { resolvePaymentAppUrl } from '@/lib/payments/app-url';
import { createServiceClient } from '@/lib/supabase/service';
import {
  sendAccountEmail,
  sendRecommendationEmail,
  sendTransactionEmail,
  sendVendorEmail,
  sendKycSecurityEmail,
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
  KycSecurityEmailInput,
} from '@/lib/email/templates';

export type EmailEventType =
  | TransactionEmailType
  | AccountEmailType
  | VendorEmailType
  | 'kyc_security_alert'
  | RecommendationEmailType;

export type EmailOutboxInput = (
  | TransactionEmailInput
  | AccountEmailInput
  | VendorEmailInput
  | RecommendationEmailInput
  | KycSecurityEmailInput
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
    kind?: KycSecurityEmailInput['kind'];
    count?: number;
    actionPath?: '/vendor/orders' | '/vendor/wallet';
  };
  status: 'pending' | 'sending' | 'sent' | 'failed';
  attempts: number;
  lease_token: string;
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
  if ('kind' in input) payload.kind = input.kind;
  if ('count' in input) payload.count = input.count;

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

export async function processEmailOutbox(limit = 20): Promise<{ sent: number; failed: number; reviewRequired: number }> {
  const db = createServiceClient();
  const { data: claimed, error: claimError } = await db.rpc('claim_email_outbox_delivery', { p_limit: limit });
  if (claimError || !claimed || !Array.isArray(claimed.rows)) throw new Error('email_claim_unavailable');

  let sent = 0;
  let failed = 0;
  let reviewRequired = Number(claimed.reviewRequired ?? 0);
  for (const row of claimed.rows as OutboxRow[]) {
    let started = false;
    let stateUnavailable = false;
    const delivery: EmailDelivery = {
      messageId: `<outbox-${row.id}@mylawatan.my>`,
      beforeSend: async () => {
        const { data, error } = await db.rpc('begin_email_outbox_delivery', { p_id: row.id, p_token: row.lease_token });
        if (error || data !== true) { stateUnavailable = true; throw new Error('email_state_unavailable'); }
        started = true;
      },
    };
    const finish = async (outcome: 'sent' | 'retry' | 'unknown', messageId: string | null = null) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const { data, error } = await db.rpc('finish_email_outbox_delivery', {
            p_id: row.id, p_token: row.lease_token, p_outcome: outcome, p_message_id: messageId,
          });
          if (!error && data === true) return;
        } catch { /* Retry acknowledgement only; never repeat SMTP here. */ }
      }
      throw new Error('email_state_unavailable');
    };
    let accepted: { id: string } | undefined;
    try {
      if (row.payload?.guestAccessToken && !row.payload.reason) {
        const {data:order,error}=await db.from('orders').select('id,contact_email,contact_name,created_at,payment_method,subtotal,discount_amount,total_amount,order_items(product_name,variant_name,unit_price,quantity)').eq('id',row.payload.reference).is('user_id',null).single();
        if (error || !order || order.contact_email !== row.to_email) throw new Error('Guest receipt unavailable');
        accepted = await sendOrderReceiptEmail({
          delivery,
          recipientEmail:row.to_email,recipientName:order.contact_name ?? 'Guest',orderId:order.id,createdAt:order.created_at,paymentMethod:order.payment_method ?? 'free_reservation',
          items:(order.order_items ?? []).map(item=>({activityName:item.product_name,variantLabel:item.variant_name ?? 'Standard',unitPrice:Number(item.unit_price),qty:item.quantity})),
          subtotal:Number(order.subtotal),discount:Number(order.discount_amount),total:Number(order.total_amount),
          accessUrl:`${resolvePaymentAppUrl()}/customer/orders/access#token=${row.payload.guestAccessToken}`,
        });
      } else if (row.event_type === 'kyc_security_alert') {
        accepted = await sendKycSecurityEmail({
          delivery,
          eventType: 'kyc_security_alert',
          kind: row.payload?.kind as KycSecurityEmailInput['kind'],
          count: Number(row.payload?.count),
          occurredAt: String(row.payload?.occurredAt ?? ''),
          to: row.to_email,
        });
      } else if (row.event_type === 'recommendation_approved') {
        accepted = await sendRecommendationEmail({
          delivery,
          eventType: row.event_type,
          recipientName: row.payload?.recipientName ?? null,
          vendorName: String(row.payload?.vendorName ?? 'Your recommendation'),
          occurredAt: String(row.payload?.occurredAt ?? new Date().toISOString()),
          to: row.to_email,
        });
      } else if (row.event_type.startsWith('vendor_')) {
        accepted = await sendVendorEmail({
          delivery,
          eventType: row.event_type as VendorEmailType,
          recipientName: row.payload?.recipientName ?? null,
          vendorName: String(row.payload?.vendorName ?? 'Your vendor'),
          reason: String(row.payload?.reason ?? 'Vendor notification update'),
          reference: row.payload?.reference ?? null,
          occurredAt: String(row.payload?.occurredAt ?? new Date().toISOString()),
          eventChange: row.payload?.eventChange,
          actionUrl: row.event_type === 'vendor_event_update' ? `${resolvePaymentAppUrl()}/vendor/events`
            : ['/vendor/orders', '/vendor/wallet'].includes(row.payload?.actionPath ?? '') ? `${resolvePaymentAppUrl()}${row.payload.actionPath}` : undefined,
          to: row.to_email,
        });
      } else if (row.event_type.startsWith('account_')) {
        accepted = await sendAccountEmail({
          delivery,
          eventType: row.event_type as AccountEmailType,
          recipientName: row.payload?.recipientName ?? null,
          reason: String(row.payload?.reason ?? 'Account status updated'),
          occurredAt: String(row.payload?.occurredAt ?? new Date().toISOString()),
          to: row.to_email,
        });
      } else {
        accepted = await sendTransactionEmail({
          delivery,
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
    } catch (error) {
      if (stateUnavailable) throw new Error('email_state_unavailable');
      const retrySafe = error instanceof EmailDeliveryError ? error.retrySafe : !started;
      await finish(retrySafe ? 'retry' : 'unknown');
      if (retrySafe) { failed += 1; if (row.attempts >= 5) reviewRequired += 1; }
      else reviewRequired += 1;
      continue;
    }
    // SMTP acceptance and its acknowledgement have separate failure boundaries.
    // Never reclassify accepted mail as retryable if this write/response is lost.
    await finish('sent', accepted?.id ?? delivery.messageId);
    sent += 1;
  }

  return { sent, failed, reviewRequired };
}
