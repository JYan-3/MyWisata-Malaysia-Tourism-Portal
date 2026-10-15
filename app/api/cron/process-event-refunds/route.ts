import { runEventOperationalJob } from '@/lib/events/operational-job';
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { processQueuedEventRefunds } from '@/lib/refunds/process-queued-event-refunds';

export const dynamic = 'force-dynamic';

/** Retries automatic refunds for cancelled event reservations that were not processed right away. */
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return NextResponse.json({ error: 'cron_not_configured' }, { status: 503 });
  if (request.headers.get('authorization') !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const service = createServiceClient();
  try {
    const result = await runEventOperationalJob(service, 'process_event_refunds', async () => {
      const result = await processQueuedEventRefunds(service);
      if (result.error) throw new Error('event_refunds_failed');
      return { processed: result.processed, awaitingProvider: result.awaitingProvider ?? 0, handedToAdmin: result.handedToAdmin };
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: 'event_refunds_failed' }, { status: 500 });
  }
}
