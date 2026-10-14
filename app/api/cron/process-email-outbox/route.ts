import { NextResponse } from 'next/server';
import { processEmailOutbox } from '@/lib/email/outbox';
import { checkKycSecurityHealth } from '@/lib/kyc/security-monitor';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  let monitorFailed = false;
  try { await checkKycSecurityHealth(); }
  catch { monitorFailed = true; }
  try {
    const result = await processEmailOutbox(20);
    if (result.reviewRequired > 0) return NextResponse.json({ ...result, error: 'email_delivery_review_required' }, { status: 503 });
    return NextResponse.json(monitorFailed ? { ...result, error: 'kyc_monitor_unavailable' } : result, { status: monitorFailed ? 503 : 200 });
  }
  catch { return NextResponse.json({ error: 'email_processing_unavailable' }, { status: 503 }); }
}
