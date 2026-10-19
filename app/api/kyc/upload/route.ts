import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { apiFail, apiOk } from '@/lib/validation/schemas';
import { hashICWithHmac } from '@/lib/kyc/hash';
import { abandonAndRemoveKycEvidence, buildKycEvidencePaths, validateKycUploadFile } from '@/lib/kyc/submission';
import { prepareKycEvidenceImage } from '@/lib/kyc/evidence-image';

const IC_PATTERNS: Record<string, RegExp> = {
  national_id: /^\d{6}-?\d{2}-?\d{4}$/,
  driving_license: /^\d{6}-?\d{2}-?\d{4}$/,
  passport: /^[A-Za-z]{1,2}[0-9]{6,8}$/,
};

function safeSubmissionFailure(error: unknown) {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string'
      ? error.message
      : '';
  if (message.includes('active_submission_exists')) {
    return apiFail('ACTIVE_SUBMISSION_EXISTS', 'You already have an active KYC submission', 409);
  }
  if (
    message.includes('invalid_ic_fingerprint')
    || message.includes('invalid_document_type')
    || message.includes('ocr_consent_required')
  ) {
    return apiFail('INVALID_EVIDENCE', 'KYC evidence is invalid', 422);
  }
  if (
    message.includes('invalid_document_path')
    || message.includes('documents_missing')
    || message.includes('invalid_document_mime')
  ) {
    return apiFail('INVALID_DOCUMENT_EVIDENCE', 'KYC document evidence is invalid', 422);
  }
  return apiFail('SUBMIT_FAILED', 'Unable to submit KYC documents', 500);
}

export async function POST(request: Request) {
  const authenticated = await createClient();
  const { data: { user } } = await authenticated.auth.getUser();
  if (!user) return apiFail('UNAUTHORIZED', 'Sign in required', 401);

  // Read-only fast path. begin also supersedes old info_requested cases, so it
  // must remain after image validation. Its atomic check still fences races.
  const service = createServiceClient();
  const { data: activeCases, error: availabilityError } = await service.from('kyc_submissions')
    .select('id').eq('user_id', user.id).in('status', ['draft', 'pending']).limit(1);
  if (availabilityError || !Array.isArray(activeCases)) return apiFail('KYC_UNAVAILABLE', 'KYC submission is temporarily unavailable', 503);
  if (activeCases.length) return apiFail('ACTIVE_SUBMISSION_EXISTS', 'You already have an active KYC submission', 409);


  let formData: FormData;
  try { formData = await request.formData(); }
  catch { return apiFail('INVALID_FORM', 'Could not parse form data', 400); }

  if (formData.get('ocrConsent') !== 'true') {
    return apiFail('OCR_CONSENT_REQUIRED', 'Consent is required for private document processing', 422);
  }

  const icNumber = formData.get('icNumber');
  const docType = formData.get('docType');
  const frontFile = formData.get('frontFile');
  const backFile = formData.get('backFile');
  if (typeof icNumber !== 'string' || typeof docType !== 'string' || !(frontFile instanceof File) || !(backFile instanceof File)) {
    return apiFail('MISSING_FIELDS', 'icNumber, docType, frontFile, and backFile are required', 422);
  }
  if (!(docType in IC_PATTERNS)) {
    return apiFail('INVALID_DOC_TYPE', 'docType must be national_id, passport, or driving_license', 422);
  }
  if (!IC_PATTERNS[docType].test(icNumber.trim().toUpperCase())) {
    return apiFail('INVALID_IC', 'IC number format does not match document type', 422);
  }

  const [front, back] = await Promise.all([validateKycUploadFile(frontFile), validateKycUploadFile(backFile)]);
  if (!front.ok) return apiFail(front.code, 'Front document must be a valid JPEG, PNG, or WebP photo under 5 MB', 422);
  if (!back.ok) return apiFail(back.code, 'Back document must be a valid JPEG, PNG, or WebP photo under 5 MB', 422);

  let images: Awaited<ReturnType<typeof prepareKycEvidenceImage>>[];
  try {
    images = await Promise.all([
      prepareKycEvidenceImage(Buffer.from(front.buffer), frontFile.type),
      prepareKycEvidenceImage(Buffer.from(back.buffer), backFile.type),
    ]);
  } catch {
    return apiFail('INVALID_FILE_CONTENT', 'Documents must be decodable photos under the image limits', 422);
  }

  let fingerprint: { algorithm: 'hmac_sha256_v1'; value: string };
  try { fingerprint = await hashICWithHmac(icNumber.trim()); }
  catch { return apiFail('SERVER_CONFIGURATION', 'KYC submission is temporarily unavailable', 503); }

  const { data: submissionId, error: beginError } = await service.rpc('begin_kyc_submission', {
    p_user_id: user.id,
    p_ic_hash: fingerprint.value,
    p_ic_hash_version: fingerprint.algorithm,
    p_doc_type: docType,
    p_ocr_consent: true,
  });
  if (beginError || typeof submissionId !== 'string') return safeSubmissionFailure(beginError);

  const paths = buildKycEvidencePaths(user.id, submissionId, crypto.randomUUID(), frontFile.type, backFile.type);
  const cleanup = async () => {
    // `abandon_kyc_submission` is the state reconciliation step: it returns
    // true only when this caller's draft was deleted. Never remove evidence
    // after a finalize timeout/error unless that proof is positive.
    const result = await abandonAndRemoveKycEvidence({ submissionId, paths, authenticated, service }).catch(() => ({ ok: false as const, reason: 'draft_not_abandoned' }));
    if (!result.ok) {
      console.error('KYC draft cleanup failed', { submissionId, reason: result.reason });
      return false;
    }
    return true;
  };

  try {
    const frontUpload = await service.storage.from('kyc-documents').upload(paths.front, images[0].stored, {
      contentType: frontFile.type, upsert: false,
    });
    if (frontUpload.error) {
      if (!await cleanup()) return apiFail('CLEANUP_FAILED', 'KYC submission state could not be safely resolved', 500);
      return apiFail('UPLOAD_FAILED', 'Unable to upload KYC documents', 502);
    }

    const backUpload = await service.storage.from('kyc-documents').upload(paths.back, images[1].stored, {
      contentType: backFile.type, upsert: false,
    });
    if (backUpload.error) {
      if (!await cleanup()) return apiFail('CLEANUP_FAILED', 'KYC submission state could not be safely resolved', 500);
      return apiFail('UPLOAD_FAILED', 'Unable to upload KYC documents', 502);
    }

    // Finalization atomically enqueues private pre-screening in the database.
    // Only watermarked evidence persists; OCR never delays the upload request.
    const { error: finalizeError } = await authenticated.rpc('finalize_kyc_submission', {
      p_submission_id: submissionId,
      p_front_path: paths.front,
      p_back_path: paths.back,
    });
    if (finalizeError) {
      if (!await cleanup()) return apiFail('CLEANUP_FAILED', 'KYC submission state could not be safely resolved', 500);
      return safeSubmissionFailure(finalizeError);
    }

    return apiOk({
      submissionId,
      status: 'pending',
      ocrStatus: 'queued',
      manualReviewRequired: true,
    }, { status: 201 });
  } catch {
    if (!await cleanup()) return apiFail('CLEANUP_FAILED', 'KYC submission state could not be safely resolved', 500);
    return apiFail('UPLOAD_FAILED', 'Unable to submit KYC documents', 502);
  }
}
