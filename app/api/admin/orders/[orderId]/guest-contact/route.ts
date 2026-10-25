import { z } from 'zod';
import { requireAccessControlSuperAdmin } from '@/lib/entitlements/admin-guard';
import { isSameOriginMutation } from '@/lib/checkout/guest-session';
import { createServiceClient } from '@/lib/supabase/service';
import { apiFail, apiOk, databaseUuidSchema } from '@/lib/validation/schemas';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  requestId: databaseUuidSchema,
  expectedContactEmail: z.string().trim().email().max(254),
  newEmail: z.string().trim().email().max(254),
  supportTicketId: databaseUuidSchema,
  evidenceKind: z.enum(['existing_order_access', 'provider_confirmed_payer']),
  paymentId: databaseUuidSchema.nullable().optional(),
}).strict().superRefine((value, context) => {
  if (value.evidenceKind === 'provider_confirmed_payer' && !value.paymentId) {
    context.addIssue({ code: 'custom', path: ['paymentId'], message: 'A successful payment record is required.' });
  }
  if (value.evidenceKind === 'existing_order_access' && value.paymentId) {
    context.addIssue({ code: 'custom', path: ['paymentId'], message: 'Payment evidence is not used for this verification method.' });
  }
});

const errorMessages: Record<string, string> = {
  FULFILMENT_CREDENTIAL_REISSUE_REQUIRED: 'This order has a separately redeemable fulfilment credential and needs manual fulfilment review.',
  EMAIL_DELIVERY_REVIEW_REQUIRED: 'An earlier access email may already have been delivered. Review delivery before changing the contact email.',
  EMAIL_DELIVERY_BUSY: 'The access email is being sent. Retry after delivery finishes.',
  guest_mail_manual_review_required: 'Too many earlier access messages require manual review before changing the contact email.',
  guest_order_contact_changed: 'The order contact changed. Refresh the order and review it again.',
  guest_contact_request_conflict: 'This correction request conflicts with an earlier attempt.',
};

export async function GET(_request: Request, context: { params: Promise<{ orderId: string }> }) {
  const auth = await requireAccessControlSuperAdmin();
  if (auth.response) return auth.response;
  const { orderId } = await context.params;
  const parsedOrderId = databaseUuidSchema.safeParse(orderId);
  if (!parsedOrderId.success) return apiFail('VALIDATION_FAILED', 'Invalid order reference.', 422);

  const db = createServiceClient();
  const { data: order, error: orderError } = await db.from('orders')
    .select('id,display_id,user_id,guest_subject_id,contact_email,status,total_amount,currency')
    .eq('id', parsedOrderId.data).maybeSingle();
  if (orderError) return apiFail('GUEST_CONTACT_PREVIEW_UNAVAILABLE', 'Unable to review this order safely.', 503);
  if (!order || order.user_id !== null || !order.guest_subject_id) return apiFail('NOT_FOUND', 'Guest order unavailable.', 404);

  const [itemsResult, paymentsResult, mailResult] = await Promise.all([
    db.from('order_items').select('id,product_id,food_fulfilment_mode,event_listing_id,event_location_id,fulfil_status,products(product_type)').eq('order_id', order.id).limit(1000),
    db.from('payments').select('id,method,provider,status,amount').eq('order_id', order.id).eq('status', 'succeeded').order('created_at', { ascending: false }).limit(20),
    db.from('email_outbox').select('id,status,delivery_state,delivery_started_at,attempts')
      .is('user_id', null).eq('to_email', order.contact_email)
      .or(`payload->>receiptOrderId.eq.${order.id},payload->>reference.eq.${order.id}`)
      .in('status', ['pending', 'failed', 'sending']).order('id').limit(101),
  ]);
  if (itemsResult.error || paymentsResult.error || mailResult.error || (itemsResult.data?.length ?? 0) >= 1000) {
    return apiFail('GUEST_CONTACT_PREVIEW_UNAVAILABLE', 'Unable to review this order safely.', 503);
  }

  const itemIds = (itemsResult.data ?? []).map((item) => item.id);
  const [digitalResult, bookingResult, passResult] = itemIds.length ? await Promise.all([
    db.from('digital_entitlements').select('id').in('order_item_id', itemIds).limit(1),
    db.from('bookings').select('status').in('order_item_id', itemIds).in('status', ['confirmed', 'in_use']).limit(1),
    db.from('ticket_passes').select('status,entries_used,entry_limit,valid_from,valid_until').in('order_item_id', itemIds).eq('status', 'active').limit(1000),
  ]) : [
    { data: [], error: null }, { data: [], error: null }, { data: [], error: null },
  ];
  if (digitalResult.error || bookingResult.error || passResult.error) return apiFail('GUEST_CONTACT_PREVIEW_UNAVAILABLE', 'Unable to review this order safely.', 503);

  const hasIndependentCredential = Boolean(digitalResult.data?.length || bookingResult.data?.length)
    || (itemsResult.data ?? []).some((item) => {
      const product = Array.isArray(item.products) ? item.products[0] : item.products;
      return item.fulfil_status !== 'cancelled' && (
        item.food_fulfilment_mode !== null || item.event_listing_id !== null || item.event_location_id !== null
        || product?.product_type === 'digital'
        || !product?.product_type
        || !['activity', 'experience', 'food', 'product', 'service', 'digital'].includes(product.product_type)
      );
    })
    || (passResult.data ?? []).some((pass) => pass.entries_used < pass.entry_limit
      && (!pass.valid_from || Date.parse(pass.valid_from) <= Date.now())
      && (!pass.valid_until || Date.parse(pass.valid_until) > Date.now()));

  const mails = mailResult.data ?? [];
  const deliveryUnknown = mails.some((mail) => mail.delivery_state === 'unknown' || (mail.status === 'failed' && mail.attempts >= 5));
  const deliveryBusy = mails.some((mail) => mail.delivery_state !== 'ready' || mail.delivery_started_at !== null);
  const eligibility = order.status !== 'paid' && order.status !== 'completed' ? 'order_not_eligible'
    : hasIndependentCredential ? 'fulfilment_reissue_required'
      : mails.length > 100 ? 'manual_mail_review_required'
        : deliveryUnknown ? 'delivery_unknown'
          : deliveryBusy ? 'delivery_busy' : 'eligible';

  return apiOk({
    order: { id: order.id, displayId: order.display_id, status: order.status, contactEmail: order.contact_email, totalAmount: order.total_amount, currency: order.currency },
    eligibility,
    pendingOldAddressMailCount: mails.length,
    successfulPayments: paymentsResult.data ?? [],
  });
}

export async function POST(request: Request, context: { params: Promise<{ orderId: string }> }) {
  if (!isSameOriginMutation(request)) return apiFail('CSRF_REJECTED', 'This request could not be verified.', 403);
  const auth = await requireAccessControlSuperAdmin();
  if (auth.response) return auth.response;

  const { orderId } = await context.params;
  const parsedOrderId = databaseUuidSchema.safeParse(orderId);
  if (!parsedOrderId.success) return apiFail('VALIDATION_FAILED', 'Invalid order reference.', 422);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiFail('VALIDATION_FAILED', 'Provide valid contact and claimant verification details.', 422, parsed.error.flatten());
  const result = parsed.data;
  const { data, error } = await auth.db.rpc('correct_guest_order_contact', {
    p_order_id: parsedOrderId.data,
    p_request_id: result.requestId,
    p_expected_contact_email: result.expectedContactEmail,
    p_new_email: result.newEmail,
    p_support_ticket_id: result.supportTicketId,
    p_evidence_kind: result.evidenceKind,
    p_payment_id: result.paymentId ?? null,
  });

  if (error) {
    const message = Object.keys(errorMessages).find((key) => error.message.includes(key)) ?? error.message.split(':')[0].trim();
    if (errorMessages[message]) return apiFail('GUEST_CONTACT_CORRECTION_BLOCKED', errorMessages[message], 409);
    if (['super_admin_required'].includes(message)) return apiFail('FORBIDDEN', 'Super Admin access required.', 403);
    if (['guest_order_unavailable', 'support_case_unavailable'].includes(message)) return apiFail('NOT_FOUND', 'The order or support case is unavailable.', 404);
    if (['guest_contact_input_invalid', 'payment_evidence_unavailable'].includes(message)) return apiFail('VALIDATION_FAILED', 'The order or claimant evidence could not be verified.', 422);
    return apiFail('GUEST_CONTACT_CORRECTION_UNAVAILABLE', 'Could not safely update this Guest order contact. Review the order and try again.', 503);
  }
  return apiOk(data);
}
