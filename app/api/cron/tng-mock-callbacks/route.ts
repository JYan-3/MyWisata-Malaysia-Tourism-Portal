import { NextResponse } from 'next/server';
import { isTngMockPayoutEnabled } from '@/lib/payouts/tng-config';
import {
  processTngMockCallbacks,
  reconcileTngMockCallbacks,
} from '@/lib/payouts/tng-mock-callbacks';
import { log } from '@/lib/log';
import { getRequestId } from '@/lib/request-id';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  const expected = process.env.CRON_SECRET;
  if (!expected || request.headers.get('authorization') !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized', requestId }, { status: 401 });
  }
  if (!isTngMockPayoutEnabled()) {
    return NextResponse.json({ error: 'Not found', requestId }, { status: 404 });
  }

  try {
    const reconciled = await reconcileTngMockCallbacks();
    const processed = await processTngMockCallbacks({ limit: 20 });
    return NextResponse.json({
      reconciled: reconciled.count,
      inserted: reconciled.inserted,
      released: reconciled.released,
      ...processed,
      requestId,
    });
  } catch (error) {
    log('error', '[cron/tng-mock-callbacks] processing failed', { requestId, error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: 'callback_processing_unavailable', requestId }, { status: 500 });
  }
}
