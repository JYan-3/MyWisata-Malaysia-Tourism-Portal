import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { log } from '@/lib/log';
import { getRequestId } from '@/lib/request-id';

const BATCH_SIZE = 1000;

async function purgeGuestRateLimits(request: Request) {
  const requestId = getRequestId(request);
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized', requestId }, { status: 401 });
  }

  try {
    const service = createServiceClient();
    const { data, error } = await service.rpc('purge_expired_guest_rate_limits', { p_batch_size: BATCH_SIZE });
    if (error || typeof data !== 'number' || !Number.isInteger(data) || data < 0 || data > BATCH_SIZE) {
      log('error', '[cron/purge-guest-rate-limits] purge failed', { requestId });
      return NextResponse.json({ error: 'purge_unavailable', requestId }, { status: 500 });
    }
    return NextResponse.json({ deleted: data, batchLimit: BATCH_SIZE, limitReached: data === BATCH_SIZE, requestId });
  } catch {
    log('error', '[cron/purge-guest-rate-limits] purge failed', { requestId });
    return NextResponse.json({ error: 'purge_unavailable', requestId }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
export const GET = purgeGuestRateLimits;
export const POST = purgeGuestRateLimits;
