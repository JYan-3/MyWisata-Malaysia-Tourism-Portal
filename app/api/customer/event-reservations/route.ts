import { privateCheckoutJson } from '@/lib/checkout/guest-session';
import { resolveCheckoutSubject, resolveCheckoutContact } from '@/lib/checkout/subject';
import { createHash } from 'node:crypto';
import { parseBody, eventCheckoutSchema } from '@/lib/validation/schemas';
import { planCheckoutPayment, startCheckoutPayment, type PreparedCheckout } from '@/lib/checkout/start-payment';
import { stampReferralFromCookie } from '@/lib/affiliate/referral-cookie';

export const dynamic = 'force-dynamic';

// Stable codes the reserve dialog translates; anything else is a generic failure.
const RESERVATION_ERRORS: Array<[string, string, string]> = [
  ['event_sold_out', 'EVENT_SOLD_OUT', 'This item is sold out for the chosen date.'],
  ['event_slot_full', 'EVENT_SLOT_FULL', 'This pickup time is full. Choose another time.'],
  ['event_slot_invalid', 'EVENT_SLOT_INVALID', 'This pickup time is no longer available.'],
  ['event_date_invalid', 'EVENT_DATE_INVALID', 'Choose a date within the event dates.'],
  ['event_item_unavailable', 'EVENT_ITEM_UNAVAILABLE', 'This item can no longer be reserved.'],
  ['invalid_payment_method', 'EVENT_PAYMENT_METHOD_INVALID', 'Choose a payment method for this reservation.'],
  ['email_verification_required', 'EMAIL_VERIFICATION_REQUIRED', 'Email verification is required before checkout'],
  ['idempotency_key_reused', 'IDEMPOTENCY_KEY_REUSED', 'Please refresh and try again.'],
];

/** POST: reserve one event item for a pickup date and time, then start payment (or confirm when free). */
export async function POST(request: Request) {
  const context = await resolveCheckoutSubject(request);
  if (!context.ok) return context.response;
  const { db, subject } = context;
  const parsed = await parseBody(request, eventCheckoutSchema, context.subject.kind === 'guest' ? { maxBytes: 32768 } : {});
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const contact = await resolveCheckoutContact(context, body.contact);
  if (!contact) return privateCheckoutJson({ error: { code: 'CONTACT_REQUIRED', message: 'Enter a valid contact email.' } }, { status: 422 });
  const user = { subject, contact };
  const planned = planCheckoutPayment(body.paymentMethod, body.paymentProvider ?? undefined, user);
  if (!planned.ok) return planned.response;

  const requestHash = createHash('sha256').update(JSON.stringify({
    kind: 'event', subject, contact,
    listingId: body.listingId,
    pickupDate: body.pickupDate,
    slotId: body.slotId,
    quantity: body.quantity,
    paymentMethod: body.paymentMethod,
    paymentProvider: body.paymentProvider ?? null,
  })).digest('hex');

  const { data: prepared, error } = await db.rpc(subject.kind === 'guest' ? 'guest_prepare_event_checkout' : 'account_prepare_event_checkout', {
    ...(subject.kind === 'guest' ? { p_guest_subject_id: subject.guestSubjectId, p_contact: contact } : { p_contact: contact }),
    p_listing_id: body.listingId,
    p_pickup_date: body.pickupDate,
    p_slot_id: body.slotId,
    p_quantity: body.quantity,
    p_payment_method: planned.plan.walletSplit ? 'stripe_card' : body.paymentMethod,
    p_idempotency_key: body.idempotencyKey,
    p_request_hash: requestHash,
  });
  if (error || !prepared) {
    const message = error?.message ?? '';
    const [, code, text] = RESERVATION_ERRORS.find(([key]) => message.includes(key))
      ?? ['', 'CHECKOUT_FAILED', 'The reservation could not be completed. Please try again.'];
    return privateCheckoutJson({ data: null, error: { code, message: text } }, { status: 409 });
  }

  const checkout = prepared as PreparedCheckout;
  // Event orders earn referral commissions too; save the referral before payment starts.
  await stampReferralFromCookie(checkout.order_id);
  return startCheckoutPayment({ db, user, request, prepared: checkout, total: Number(checkout.total), plan: planned.plan });
}
