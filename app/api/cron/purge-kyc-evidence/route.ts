import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { log } from '@/lib/log';
import { getRequestId } from '@/lib/request-id';

const BUCKET = 'kyc-documents';

type PurgeWorkItem = {
  submission_id: string;
  side: 'front' | 'back';
  storage_path: string;
};

/**
 * POST /api/cron/purge-kyc-evidence
 *
 * Claims expired KYC evidence through the service-only RPC, removes each
 * private object, then confirms successful deletions. The response contains
 * aggregate counts only; object paths and identifiers never leave the job —
 * that also holds for logging below: only error.message is logged, never
 * item.storage_path or item.submission_id.
 */
export async function POST(request: Request) {
  const requestId = getRequestId(request);
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized', requestId }, { status: 401 });
  }

  const service = createServiceClient();
  const { data, error } = await service.rpc('purge_expired_kyc_evidence');
  if (error) {
    log('error', '[cron/purge-kyc-evidence] claim failed', { requestId, error: error.message });
    return NextResponse.json({ error: 'purge_unavailable', requestId }, { status: 500 });
  }

  const worklist = Array.isArray(data) ? (data as PurgeWorkItem[]) : [];
  let purged = 0;
  let failed = 0;

  for (const item of worklist) {
    if (!item || (item.side !== 'front' && item.side !== 'back') ||
        typeof item.submission_id !== 'string' || typeof item.storage_path !== 'string') {
      failed += 1;
      continue;
    }

    const { error: removeError } = await service.storage.from(BUCKET).remove([item.storage_path]);
    if (removeError) {
      failed += 1;
      log('error', '[cron/purge-kyc-evidence] object removal failed', { requestId, error: removeError.message });
      continue;
    }

    const { data: confirmed, error: confirmError } = await service.rpc('confirm_purged_kyc_evidence', {
      p_submission_id: item.submission_id,
      p_side: item.side,
    });
    if (confirmError || confirmed !== true) {
      failed += 1;
      if (confirmError) log('error', '[cron/purge-kyc-evidence] confirmation failed', { requestId, error: confirmError.message });
      continue;
    }
    purged += 1;
  }

  return NextResponse.json({ claimed: worklist.length, purged, failed, requestId });
}
