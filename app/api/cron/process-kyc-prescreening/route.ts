import { createServiceClient } from '@/lib/supabase/service';
import { processKycPrescreening } from '@/lib/kyc/prescreening';
import { runKycSyntheticProbe } from '@/lib/kyc/ocr-synthetic-probe';
import { portalQueueHealth, recordPortalDispatch } from '@/lib/operations/queue-health';

export const runtime = 'nodejs';

/** Aggregate operational status only; never return jobs, holders or evidence paths. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return Response.json({ error: 'unauthorized' }, { status: 401 });
  try { return Response.json(await portalQueueHealth(), { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return Response.json({ error: 'queue_health_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}

async function readMode(request: Request) {
  if (!request.body) return null;
  const reader = request.body.getReader();
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 1024) { await reader.cancel(); throw new Error('body_too_large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!length) return null;
  const data: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length !== 1 || !('mode' in data) || data.mode !== 'synthetic-check') throw new Error('mode_invalid');
  return 'synthetic-check';
}

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return Response.json({ error: 'unauthorized' }, { status: 401 });
  let mode;
  try { mode = await readMode(request); }
  catch (error) { return Response.json({ error: 'invalid_request' }, { status: error instanceof Error && error.message === 'body_too_large' ? 413 : 400 }); }
  try {
    if (mode) {
      if (process.env.KYC_NODE_OCR_PROBE_ENABLED !== 'true' || process.env.KYC_PRESCREENING_ENABLED === 'true') return Response.json({ error: 'probe_disabled' }, { status: 403 });
      const probe = await runKycSyntheticProbe();
      return Response.json(probe, { status: probe.ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
    }
    await recordPortalDispatch('kyc', 'started');
    const result = await processKycPrescreening(createServiceClient());
    await recordPortalDispatch('kyc', result.enabled && !result.writeErrors && !result.notAcknowledged ? 'succeeded' : 'failed');
    return Response.json(result, { status: result.writeErrors > 0 ? 503 : 200, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'kyc_prescreening_unavailable' }, { status: 503 });
  }
}
