import { NextResponse } from 'next/server';
import { processEmailOutbox } from '@/lib/email/outbox';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const configuredSecret = process.env.EMAIL_OUTBOX_SECRET;
  const suppliedSecret = req.headers.get('x-email-outbox-secret');
  if (!configuredSecret || suppliedSecret !== configuredSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let limit = 20;
  try {
    const body = await req.json() as { limit?: unknown };
    if (Number.isInteger(body.limit) && Number(body.limit) > 0) limit = Math.min(Number(body.limit), 100);
  } catch {
    // Empty body uses the default limit.
  }

  try {
    const result = await processEmailOutbox(limit);
    return NextResponse.json(result, { status: result.reviewRequired > 0 ? 503 : 200 });
  } catch {
    console.error('[email-outbox] email_processing_unavailable');
    return NextResponse.json({ error: 'Email processing failed' }, { status: 500 });
  }
}
