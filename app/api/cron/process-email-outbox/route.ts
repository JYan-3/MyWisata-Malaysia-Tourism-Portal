import { NextResponse } from 'next/server';
import { processEmailOutbox } from '@/lib/email/outbox';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try { return NextResponse.json(await processEmailOutbox(20)); }
  catch { return NextResponse.json({ error: 'email_processing_unavailable' }, { status: 503 }); }
}
