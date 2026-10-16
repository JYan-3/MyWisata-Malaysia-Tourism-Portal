import 'server-only';
import type { createServiceClient } from '@/lib/supabase/service';
import { privateKycOcrConfiguration, runKycOcr, type KycOcrResult } from './ocr';

type Service = ReturnType<typeof createServiceClient>;
type Job = {
  id: string; submissionId: string; leaseToken: string;
  documentType: 'national_id' | 'passport' | 'driving_license';
  expectedDocumentNumberHmac: string | null; expectedHolderName: string | null;
  documents: { side: 'front' | 'back'; path: string; mimeType: string }[];
};
const unavailable = (failureCode: NonNullable<KycOcrResult['failureCode']> = 'evidence_invalid', retryable = false): KycOcrResult => ({ failureCode, retryable, status: 'unavailable', holderName: null, documentNumberHmac: null,
  documentNumberLast4: null, expiryDate: null, confidence: null, mismatchFields: [], providerModel: 'private-ocr-v1' });

class EvidenceFailure extends Error {
  constructor(public failureCode: NonNullable<KycOcrResult['failureCode']>, public retryable: boolean) {
    super('kyc_evidence_unavailable');
  }
}

/** These are safety bounds, not enabled production budgets. All values need operator configuration. */
export function kycPrescreeningBudget() {
  const integer = (name: string, maximum: number) => {
    const value = Number(process.env[name]);
    return Number.isSafeInteger(value) && value >= 1 && value <= maximum ? value : null;
  };
  const batch = integer('KYC_PRESCREENING_BATCH_SIZE', 20);
  const running = integer('KYC_PRESCREENING_MAX_RUNNING', 20);
  const lease = integer('KYC_PRESCREENING_LEASE_SECONDS', 3600);
  const attempts = integer('KYC_PRESCREENING_MAX_ATTEMPTS', 10);
  const retry = integer('KYC_PRESCREENING_RETRY_SECONDS', 86400);
  const privateOcr = privateKycOcrConfiguration();
  if (process.env.KYC_PRESCREENING_ENABLED !== 'true' || !process.env.KYC_IC_HMAC_KEY ||
      !batch || !running || !lease || !attempts || !retry || !privateOcr || lease * 1000 <= privateOcr.timeoutMs * 2) return null;
  const drain = process.env.KYC_PRESCREENING_DRAIN_ENABLED === 'true';
  const maxBatches = drain ? integer('KYC_PRESCREENING_DRAIN_MAX_BATCHES', 20) : 1;
  const timeMs = drain ? integer('KYC_PRESCREENING_DRAIN_BUDGET_MS', 120000) : null;
  if (!maxBatches || (drain && (!timeMs || timeMs <= privateOcr.timeoutMs * 2))) return null;
  return { batch, running, lease, attempts, retry, maxBatches, timeMs, timeoutMs: privateOcr.timeoutMs };
}

export async function processKycPrescreening(service: Service) {
  const budget = kycPrescreeningBudget();
  const summary = { enabled: Boolean(budget), claimed: 0, acknowledged: 0, ocrProcessed: 0, unavailable: 0, notAcknowledged: 0, writeErrors: 0, batches: 0, stopReason: 'disabled', failureCounts: {} as Record<string, number> };
  if (!budget) return summary;
  const deadline = budget.timeMs ? performance.now() + budget.timeMs : null;
  for (let batchIndex = 0; batchIndex < budget.maxBatches; batchIndex += 1) {
    if (deadline !== null && performance.now() + budget.timeoutMs * 2 >= deadline) { summary.stopReason = 'time_budget'; break; }
    let serviceFailed = false;
    const { data, error } = await service.rpc('claim_kyc_prescreening_jobs', {
      p_limit: budget.batch, p_lease_seconds: budget.lease, p_max_attempts: budget.attempts, p_max_running: budget.running,
    });
    if (error || !Array.isArray(data)) throw new Error('kyc_job_claim_failed');
    if (!data.length) { summary.stopReason = 'empty'; break; }
    summary.claimed += data.length;
    summary.batches += 1;
    // SQL caps all workers together. No detached promises or request-local queue.
    await Promise.all((data as Job[]).map(async (job) => {
      let result = unavailable();
      try {
        const read = async (side: 'front' | 'back') => {
          const document = job.documents.find((item) => item.side === side);
          if (!document || !['image/jpeg', 'image/png', 'image/webp'].includes(document.mimeType)) throw new EvidenceFailure('evidence_invalid', false);
          const download = await service.storage.from('kyc-documents').download(document.path, {}, { signal: AbortSignal.timeout(budget.timeoutMs) })
            .catch(() => { throw new EvidenceFailure('network', true); });
          const { data: blob, error: storageError } = download;
          if (storageError) {
            const status = 'statusCode' in storageError ? String(storageError.statusCode) : '';
            throw new EvidenceFailure(status === '404' ? 'evidence_missing' : ['401', '403'].includes(status) ? 'configuration' : 'network', !['401', '403', '404'].includes(status));
          }
          if (!blob || blob.size === 0 || blob.size > 5 * 1024 * 1024) throw new EvidenceFailure('evidence_invalid', false);
          return { mimeType: document.mimeType, bytes: new Uint8Array(await blob.arrayBuffer()) };
        };
        if (job.expectedDocumentNumberHmac && /^[a-f0-9]{64}$/.test(job.expectedDocumentNumberHmac)) {
          // Wait for both bounded reads even if one fails; never release a job with a detached read.
          const [frontRead, backRead] = await Promise.allSettled([read('front'), read('back')]);
          const failed = [frontRead, backRead].filter((value) => value.status === 'rejected');
          const permanent = failed.find((value) => value.reason instanceof EvidenceFailure && !value.reason.retryable);
          if (permanent) throw permanent.reason;
          if (frontRead.status === 'rejected') throw frontRead.reason;
          if (backRead.status === 'rejected') throw backRead.reason;
          const front = frontRead.value, back = backRead.value;
          result = await runKycOcr({ documentType: job.documentType,
            expectedDocumentNumberHmac: job.expectedDocumentNumberHmac, expectedHolderName: job.expectedHolderName,
            front, back, hmacKey: process.env.KYC_IC_HMAC_KEY ?? '' });
          // Until a confidence cutoff is calibrated and explicitly configured,
          // consistent OCR remains an uncertain signal for a human to assess.
          const thresholdText = process.env.KYC_PRIVATE_OCR_MIN_CONFIDENCE;
          const threshold = thresholdText ? Number(thresholdText) : NaN;
          if (result.status === 'matched' && (!job.expectedHolderName || !Number.isFinite(threshold) || threshold <= 0 || threshold > 1 ||
              result.confidence === null || result.confidence < threshold)) {
            result = { ...result, status: 'mismatch', mismatchFields: [...result.mismatchFields, 'confidence_unvalidated'] };
          }
        }
      } catch (error) {
        result = error instanceof EvidenceFailure ? unavailable(error.failureCode, error.retryable) : unavailable('network', true);
      }
      if (result.status === 'unavailable') {
        const code = result.failureCode ?? 'service_unavailable';
        summary.failureCounts[code] = (summary.failureCounts[code] ?? 0) + 1;
        if (!code.startsWith('evidence_')) serviceFailed = true;
      }
      try {
        const { data: saved, error: finishError } = await service.rpc('finish_kyc_prescreening_job', {
          p_job_id: job.id, p_token: job.leaseToken, p_result: result, p_retry_seconds: budget.retry,
        });
        if (finishError) summary.writeErrors += 1;
        else if (saved === true) {
          summary.acknowledged += 1;
          if (result.status === 'unavailable') summary.unavailable += 1;
          else summary.ocrProcessed += 1;
        }
        else summary.notAcknowledged += 1;
      } catch { summary.writeErrors += 1; }
    }));
    summary.stopReason = summary.writeErrors ? 'write_error' : serviceFailed ? 'service_unavailable' : budget.maxBatches === 1 ? 'single_batch' : 'max_batches';
    if (summary.writeErrors || serviceFailed) break;
  }
  return summary;
}
