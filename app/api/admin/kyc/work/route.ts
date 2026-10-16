import { requireKycReviewer } from '@/lib/kyc/reviewer-auth';
import { kycWorkSchema } from '@/lib/kyc/operations';
import { apiFail, apiOk, parseBody } from '@/lib/validation/schemas';

export async function POST(request: Request) {
  const { db, response } = await requireKycReviewer();
  if (response) return response;
  const parsed = await parseBody(request, kycWorkSchema);
  if (!parsed.ok) return parsed.response;
  const { data, error } = await db.rpc('manage_kyc_review_work', {
    p_action: parsed.data.action, p_submission_id: parsed.data.submissionId ?? null,
    p_expected_version: parsed.data.expectedVersion ?? null, p_session_id: parsed.data.sessionId ?? null,
  });
  if (error || !data) return apiFail('KYC_WORK_CONFLICT', 'Unable to update this assignment; reload the queue', 409);
  const result = apiOk(data);
  result.headers.set('Cache-Control', 'private, no-store');
  return result;
}
