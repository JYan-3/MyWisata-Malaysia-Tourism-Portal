// P4 — Member 4: wires affiliate attribution into REAL checkout.
// CLAUDE-CHECKOUT-WIRE.md — CASE B (client-side createOrder), variant B2.
//
// Why B2, not B1: app/customer/checkout/page.tsx is "use client" and imports
// backend/domains/commerce.ts::createOrder() directly. That module has no
// "use server" boundary, so it — and everything it imports — is bundled into
// the browser. lib/affiliate/attribution.ts::onOrderPaid() imports next/headers's
// cookies(), which is guarded by the `server-only` package and throws a
// build-time error the moment it's reachable from a client bundle. Inlining
// the onOrderPaid() call inside createOrder() (CASE B1's literal instructions)
// would not compile for this codebase. This route is the smallest fix that
// actually works: ZERO changes to commerce.ts, one new server-side endpoint,
// one small non-blocking client-side call after order creation.
//
// Does not re-derive anything the client claims — takes only orderId as
// input, confirms it belongs to the caller, then reads mw_ref itself
// server-side (the real httpOnly cookie, not anything the client could
// forge) before validating it against affiliate_clicks.

import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { parseBody, apiOk, apiFail } from '@/lib/validation/schemas';
import { attributeCheckoutSchema } from '@/lib/validation/affiliate-schemas';
import { stampReferralFromCookie } from '@/lib/affiliate/referral-cookie';
import { settleOrderVendorEarnings } from '@/lib/vendor/settlement';
import { runPaidOrderEffects } from '@/lib/orders/paid-order-effects';

// Fast path only. The 5-minute job (/api/cron/process-paid-orders) runs the same
// effects for every paid order, including guests, events and redirect payments
// whose buyer never comes back here. Both are idempotent, so overlap is harmless.
export async function POST(request: Request) {
  const authClient = await createClient();
  const { data: { user } } = await authClient.auth.getUser();
  if (!user) return apiFail('UNAUTHORIZED', 'Sign in required', 401);

  const parsed = await parseBody(request, attributeCheckoutSchema);
  if (!parsed.ok) return parsed.response;
  const { orderId } = parsed.data;

  const service = createServiceClient();

  // Ownership check: don't let user A attribute (or probe the existence of) user B's order.
  const { data: order } = await service.from('orders').select('id,user_id').eq('id', orderId).maybeSingle();
  if (!order || order.user_id !== user.id) return apiFail('NOT_FOUND', 'Order not found', 404);

  // Normally saved at checkout already; this only fills it in if it is still missing.
  await stampReferralFromCookie(orderId);
  await settleOrderVendorEarnings(service, orderId); // idempotent (order_settlements unique key); never throws
  // Commission, recommendation rewards and fee floor. A failure is retried by the job.
  await runPaidOrderEffects(service, orderId);

  return apiOk({ attributed: true });
}
