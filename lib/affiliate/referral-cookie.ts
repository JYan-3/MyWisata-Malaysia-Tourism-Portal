// Saves the buyer's affiliate referral onto an order the moment it is created.
//
// The referral lives in the mw_ref cookie (set by lib/affiliate/redirect.ts),
// which only exists while the buyer's browser is talking to us. Commissions are
// created later, often by a background job after a redirect payment (TNG,
// GrabPay, bank, FPX), so the click must be on the order before the buyer
// leaves. Works the same for signed-in and guest buyers.

import { cookies } from 'next/headers';
import { createServiceClient } from '@/lib/supabase/service';
import { databaseUuidSchema } from '@/lib/validation/schemas';

export const MW_REF_COOKIE = 'mw_ref';

/**
 * Copies a valid mw_ref click onto the order. A forged or unknown cookie is
 * ignored, an order that already has a referral keeps it, and it never throws:
 * a referral problem must not block a checkout.
 */
export async function stampReferralFromCookie(orderId: string | null | undefined): Promise<void> {
  if (!orderId) return;
  try {
    const clickId = (await cookies()).get(MW_REF_COOKIE)?.value;
    if (!clickId || !databaseUuidSchema.safeParse(clickId).success) return;
    const service = createServiceClient();
    const { data: click } = await service.from('affiliate_clicks').select('id').eq('id', clickId).maybeSingle();
    if (!click) return;
    const { error } = await service.from('orders').update({ affiliate_click_id: click.id }).eq('id', orderId).is('affiliate_click_id', null);
    if (error) console.error('[affiliate] referral stamp failed', orderId, error.message);
  } catch (error) {
    console.error('[affiliate] referral stamp failed', orderId, error instanceof Error ? error.message : error);
  }
}
