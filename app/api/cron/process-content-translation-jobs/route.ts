import { NextResponse } from 'next/server';
import { processContentTranslationJobs } from '@/lib/content-translations/worker';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json(await processContentTranslationJobs(4));
  } catch {
    return NextResponse.json({ error: 'content_translation_processing_unavailable' }, { status: 503 });
  }
}
