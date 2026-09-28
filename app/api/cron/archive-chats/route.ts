import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getChatArchiveDays } from '@/lib/chat/settings';
import { log } from '@/lib/log';
import { getRequestId } from '@/lib/request-id';

/**
 * POST /api/cron/archive-chats
 *
 * Marks open chat threads idle past the configured threshold as 'archived'.
 * Status-only — message history is untouched, and sendMessage reopens a
 * thread automatically the next time either side sends a message.
 */
async function archiveInactiveChats(request: Request) {
  const requestId = getRequestId(request);
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized', requestId }, { status: 401 });
  }

  const service = createServiceClient();
  const days = await getChatArchiveDays(service);
  const { data, error } = await service.rpc('archive_inactive_chats', { days });
  if (error) {
    log('error', '[cron/archive-chats] archive failed', { requestId, error: error.message });
    return NextResponse.json({ error: 'archive_unavailable', requestId }, { status: 500 });
  }

  return NextResponse.json({ archived: data ?? 0, thresholdDays: days, requestId });
}

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return archiveInactiveChats(request);
}

export async function POST(request: Request) {
  return archiveInactiveChats(request);
}
