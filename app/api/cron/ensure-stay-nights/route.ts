import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { log } from '@/lib/log';
import { getRequestId } from '@/lib/request-id';

const STAY_HORIZON_DAYS = 180;

/**
 * GET|POST /api/cron/ensure-stay-nights
 *
 * Tops up one booking slot per room type per Malaysia calendar night, 180 days ahead.
 * Idempotent: existing nights are left untouched.
 */
async function ensureStayNights(request: Request) {
  const requestId = getRequestId(request);
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized', requestId }, { status: 401 });
  }

  const service = createServiceClient();
  const { data, error } = await service.rpc('ensure_stay_nights', { p_days: STAY_HORIZON_DAYS });
  if (error) {
    log('error', '[cron/ensure-stay-nights] top-up failed', { requestId, error: error.message });
    return NextResponse.json({ error: 'ensure_stay_nights_unavailable', requestId }, { status: 500 });
  }

  return NextResponse.json({ inserted: data ?? 0, horizonDays: STAY_HORIZON_DAYS, requestId });
}

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return ensureStayNights(request);
}

export async function POST(request: Request) {
  return ensureStayNights(request);
}
