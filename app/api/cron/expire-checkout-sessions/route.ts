import { runEventOperationalJob } from '@/lib/events/operational-job';
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return NextResponse.json({ error: 'cron_not_configured' }, { status: 503 });
  if (request.headers.get('authorization') !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const service = createServiceClient();
  try {
    const result = await runEventOperationalJob(service, 'expire_checkout_sessions', async () => {
      const { data, error } = await service.rpc('expire_checkout_sessions');
      if (error) throw new Error('checkout_expiration_failed');
      const { data: pickups, error: pickupError } = await service.rpc('refresh_overdue_event_pickups');
      if (pickupError) throw new Error('pickup_discovery_failed');
      return { expired: Number(data ?? 0), pickupsOpened: Number(pickups?.opened ?? 0), pickupsClosed: Number(pickups?.closed ?? 0) };
    });
    return NextResponse.json(result);
  } catch (error) {
    const code = error instanceof Error && error.message === 'pickup_discovery_failed'
      ? 'pickup_discovery_failed' : 'checkout_expiration_failed';
    return NextResponse.json({ error: code }, { status: 500 });
  }
}
