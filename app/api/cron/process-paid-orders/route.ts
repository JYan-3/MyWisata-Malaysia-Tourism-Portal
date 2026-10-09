import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { processPaidOrders } from '@/lib/orders/paid-order-effects';

// Every 5 minutes (vercel.json): affiliate commissions, recommendation rewards
// and the fee floor for paid orders, whatever the payment method.
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try { return NextResponse.json(await processPaidOrders(createServiceClient())); }
  catch { return NextResponse.json({ error: 'paid_order_processing_unavailable' }, { status: 503 }); }
}
