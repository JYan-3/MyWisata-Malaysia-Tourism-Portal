import { requireKycReviewer } from '@/lib/kyc/reviewer-auth';
import { kycReviewSchema, parseBody, apiOk, apiFail } from '@/lib/validation/schemas';

export async function POST(request: Request) {
  const { db: supabase, user, response } = await requireKycReviewer();
  if (response) return response;
  if (!user) return apiFail('UNAUTHORIZED', 'Sign in required', 401);

  const parsed = await parseBody(request, kycReviewSchema);
  if (!parsed.ok) return parsed.response;
  const { submissionId, userId, expectedVersion, action, reasonCode, reasonDetail } = parsed.data;
  const trimmedReasonDetail = reasonDetail?.trim() || null;

  const { error: rpcErr } = await supabase.rpc('review_kyc_case', {
    p_submission_id: submissionId,
    p_user_id: userId,
    p_expected_version: expectedVersion,
    p_action: action,
    p_reason_code: action === 'approve' ? null : reasonCode ?? null,
    p_reason_detail: action === 'approve' ? null : trimmedReasonDetail,
  });

  if (rpcErr) {
    const message = rpcErr.message ?? '';
    if (message.includes('admin_required') || message.includes('kyc_permission_required'))
      return apiFail('FORBIDDEN', 'KYC review permission required', 403);
    if (message.includes('self_dealing'))
      return apiFail('SELF_DEALING', 'You cannot review your own KYC submission', 403);
    if (message.includes('kyc_not_active_or_not_found'))
      return apiFail('CONFLICT', 'No active KYC submission found for this user', 409);
    if (message.includes('kyc_assignment_changed'))
      return apiFail('CONFLICT', 'Assignment changed; reload this case before deciding', 409);
    if (message.includes('kyc_not_assigned'))
      return apiFail('CONFLICT', 'This KYC submission is assigned to another reviewer', 409);
    if (message.includes('invalid_action') || message.includes('reason_not_allowed')
        || message.includes('invalid_reason_code') || message.includes('reason_code_not_allowed')
        || message.includes('reason_detail_not_allowed') || message.includes('reason_detail_too_short')) {
      return apiFail('VALIDATION_FAILED', 'KYC review request failed validation', 422);
    }
    return apiFail('RPC_ERROR', 'KYC review could not be completed', 500);
  }

  const kycStatus = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'pending';

  return apiOk({ userId, kycStatus, action });
}
